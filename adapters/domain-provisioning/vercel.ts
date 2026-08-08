import { z } from 'zod';

import type { DomainCheck, DomainPort } from '#core/server/index.js';

export interface VercelDomainPortConfig {
  readonly token: string;
  readonly projectId: string;
  /** Only for a team-owned project; omitted on a personal one. */
  readonly teamId?: string | undefined;
  /** Injected so tests drive the adapter without a network. */
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

const API_ORIGIN = 'https://api.vercel.com';
const DEFAULT_TIMEOUT_MS = 10_000;

/** The one field of the project-domain object this port reads. */
const projectDomainSchema = z.object({ verified: z.boolean() });

/** Whether the host's DNS actually points at the deployment. */
const domainConfigSchema = z.object({ misconfigured: z.boolean() });

const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

type Outcome<T> = { ok: true; data: T } | { ok: false; status: number; detail: string };

/** `0` marks a transport failure (no HTTP status was ever received). */
const NO_STATUS = 0;

const describeApiError = (payload: unknown): string => {
  const parsed = apiErrorSchema.safeParse(payload);
  return parsed.success
    ? `${parsed.data.error.code}: ${parsed.data.error.message}`
    : 'no recognizable error body';
};

// The token itself never appears in a detail string — an auth failure names the
// env keys to fix instead, so the credential cannot leak through a log or an
// error surfaced to a tenant.
const describeFailure = (status: number, payload: unknown): string =>
  status === 401 || status === 403
    ? `Vercel rejected the credentials (HTTP ${status}, ${describeApiError(payload)}) — check VERCEL_TOKEN's scope and VERCEL_TEAM_ID`
    : `Vercel API failed (HTTP ${status}, ${describeApiError(payload)})`;

const requestUrl = (config: VercelDomainPortConfig, path: string): string => {
  const url = new URL(path, API_ORIGIN);
  if (config.teamId) url.searchParams.set('teamId', config.teamId);
  return url.toString();
};

const call = async <S extends z.ZodTypeAny>(
  config: VercelDomainPortConfig,
  request: { method: string; path: string; body?: unknown },
  schema: S,
): Promise<Outcome<z.output<S>>> => {
  const fetchImpl = config.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(requestUrl(config, request.path), {
      method: request.method,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: request.body === undefined ? null : JSON.stringify(request.body),
      signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    return { ok: false, status: NO_STATUS, detail: `Vercel API unreachable: ${String(cause)}` };
  }

  // An unreadable body is `undefined`, not a failure of its own: the schema below
  // decides, so an empty 200 (the delete response) passes while a corrupted body
  // fails wherever a shape is actually read.
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    return { ok: false, status: response.status, detail: describeFailure(response.status, payload) };
  }

  const parsed = schema.safeParse(payload);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : {
        ok: false,
        status: response.status,
        detail: `Vercel response did not match the expected shape (HTTP ${response.status})`,
      };
};

const projectDomainsPath = (config: VercelDomainPortConfig): string =>
  `/v10/projects/${encodeURIComponent(config.projectId)}/domains`;

const projectDomainPath = (config: VercelDomainPortConfig, domain: string): string =>
  `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(domain)}`;

const rejected = (detail: string): DomainCheck => ({ resolved: false, detail });

/**
 * Vercel Domains API DomainPort (US-020). Certificates on a records-only zone are
 * per host over HTTP-01, so every tenant host must be attached to the project
 * individually — `provision` attaches, `remove` detaches, `check` reads the
 * domain and its DNS config back. Nothing here is inferred from running on
 * Vercel: the composition root selects this adapter only on an explicit
 * `DOMAIN_PROVISIONER=vercel` with its credential block.
 */
export const createVercelDomainPort = (config: VercelDomainPortConfig): DomainPort => ({
  provision: async (domain) => {
    const result = await call(
      config,
      { method: 'POST', path: projectDomainsPath(config), body: { name: domain } },
      projectDomainSchema,
    );
    // Attaching is convergent: 409 means the host is already on the project, so a
    // retry (or a re-added tenant domain) must succeed rather than fail the flow.
    if (!result.ok && result.status !== 409) {
      throw new Error(`Vercel could not attach "${domain}": ${result.detail}`);
    }
  },

  remove: async (domain) => {
    const result = await call(
      config,
      { method: 'DELETE', path: projectDomainPath(config, domain) },
      // The delete response carries nothing this port reads.
      z.unknown(),
    );
    // Detaching is convergent too: 404 means it is already gone.
    if (!result.ok && result.status !== 404) {
      throw new Error(`Vercel could not detach "${domain}": ${result.detail}`);
    }
  },

  check: async (domain) => {
    const attached = await call(
      config,
      { method: 'GET', path: projectDomainPath(config, domain) },
      projectDomainSchema,
    );
    if (!attached.ok) {
      return rejected(
        attached.status === 404
          ? `${domain} is not attached to the Vercel project`
          : `${domain}: ${attached.detail}`,
      );
    }
    if (!attached.data.verified) {
      return rejected(`${domain} is attached to the Vercel project but not verified yet`);
    }

    const dns = await call(
      config,
      { method: 'GET', path: `/v6/domains/${encodeURIComponent(domain)}/config` },
      domainConfigSchema,
    );
    if (!dns.ok) return rejected(`${domain}: ${dns.detail}`);
    return dns.data.misconfigured
      ? rejected(`${domain} is verified but Vercel reports its DNS as misconfigured`)
      : { resolved: true, detail: `${domain} is attached and verified on the Vercel project` };
  },
});
