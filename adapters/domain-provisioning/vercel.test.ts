import { describe, expect, it, vi } from 'vitest';

import { createVercelDomainPort } from './vercel.js';

const TOKEN = 'super-secret-vercel-token';

interface StubReply {
  status?: number;
  body?: unknown;
  /** Raw body text, for replies `response.json()` cannot parse (empty, HTML). */
  raw?: string;
}

const stubFetch = (...replies: StubReply[]) => {
  const queue = [...replies];
  return vi.fn<typeof fetch>(async () => {
    const reply = queue.shift() ?? { status: 500 };
    return new Response(reply.raw ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
};

const port = (fetchImpl: typeof fetch, over: { teamId?: string } = {}) =>
  createVercelDomainPort({ token: TOKEN, projectId: 'prj_123', fetchImpl, ...over });

const callOf = (fetchImpl: ReturnType<typeof stubFetch>, index = 0) => {
  const call = fetchImpl.mock.calls[index];
  if (call === undefined) throw new Error(`no fetch call at index ${index}`);
  const [url, init] = call;
  return { url: String(url), init: init ?? {} };
};

const failureOf = (attempt: Promise<void>): Promise<string> =>
  attempt.then(() => 'resolved', (cause: unknown) => String(cause));

describe('createVercelDomainPort — provision', () => {
  it('attaches the host to the project, authorizing with a bearer token only', async () => {
    const fetchImpl = stubFetch({ body: { verified: false } });
    await port(fetchImpl).provision('shop.acme.com');

    const { url, init } = callOf(fetchImpl);
    expect(url).toBe('https://api.vercel.com/v10/projects/prj_123/domains');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'shop.acme.com' }));
    expect(init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('scopes the call to a team when a team id is configured', async () => {
    const fetchImpl = stubFetch({ body: { verified: true } });
    await port(fetchImpl, { teamId: 'team_42' }).provision('shop.acme.com');
    expect(callOf(fetchImpl).url).toBe(
      'https://api.vercel.com/v10/projects/prj_123/domains?teamId=team_42',
    );
  });

  it('treats an already-attached host (409) as success — attaching is convergent', async () => {
    const fetchImpl = stubFetch({
      status: 409,
      body: { error: { code: 'domain_already_in_use', message: 'already in use' } },
    });
    await expect(port(fetchImpl).provision('shop.acme.com')).resolves.toBeUndefined();
  });

  it('fails on 401 naming the misconfigured env, never the token value', async () => {
    const fetchImpl = stubFetch({
      status: 401,
      body: { error: { code: 'forbidden', message: 'Not authorized' } },
    });
    const failure = await failureOf(port(fetchImpl).provision('shop.acme.com'));

    expect(failure).toContain("VERCEL_TOKEN's scope and VERCEL_TEAM_ID");
    expect(failure).toContain('HTTP 401');
    expect(failure).not.toContain(TOKEN);
  });

  it('fails on 403 (token lacking the domains scope, or the wrong team)', async () => {
    const fetchImpl = stubFetch({
      status: 403,
      body: { error: { code: 'forbidden', message: 'Not authorized to access this team' } },
    });
    await expect(port(fetchImpl).provision('shop.acme.com')).rejects.toThrow(/HTTP 403/);
  });

  it('fails on a 5xx, carrying the status', async () => {
    const fetchImpl = stubFetch({ status: 503 });
    await expect(port(fetchImpl).provision('shop.acme.com')).rejects.toThrow(/HTTP 503/);
  });

  it('fails on a transport error (timeout, DNS, connection reset)', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new DOMException('The operation was aborted', 'TimeoutError');
    };
    await expect(port(fetchImpl).provision('shop.acme.com')).rejects.toThrow(/unreachable/);
  });

  it('fails when the response does not match the expected shape', async () => {
    const fetchImpl = stubFetch({ body: { verified: 'yes' } });
    await expect(port(fetchImpl).provision('shop.acme.com')).rejects.toThrow(/did not match/);
  });
});

describe('createVercelDomainPort — remove', () => {
  it('detaches the host from the project', async () => {
    const fetchImpl = stubFetch({ body: {} });
    await port(fetchImpl).remove('shop.acme.com');

    const { url, init } = callOf(fetchImpl);
    expect(url).toBe('https://api.vercel.com/v9/projects/prj_123/domains/shop.acme.com');
    expect(init.method).toBe('DELETE');
  });

  it('accepts an empty body (the delete response carries nothing we read)', async () => {
    const fetchImpl = stubFetch({ raw: '' });
    await expect(port(fetchImpl).remove('shop.acme.com')).resolves.toBeUndefined();
  });

  it('treats an unknown host (404) as success — detaching is convergent', async () => {
    const fetchImpl = stubFetch({ status: 404, body: { error: { code: 'not_found', message: 'nope' } } });
    await expect(port(fetchImpl).remove('shop.acme.com')).resolves.toBeUndefined();
  });

  it('fails on a 5xx', async () => {
    const fetchImpl = stubFetch({ status: 500 });
    await expect(port(fetchImpl).remove('shop.acme.com')).rejects.toThrow(/could not detach/);
  });
});

describe('createVercelDomainPort — check', () => {
  it('resolves when the domain is verified and its DNS is configured', async () => {
    const fetchImpl = stubFetch({ body: { verified: true } }, { body: { misconfigured: false } });
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(true);
    expect(callOf(fetchImpl, 0).url).toBe(
      'https://api.vercel.com/v9/projects/prj_123/domains/shop.acme.com',
    );
    expect(callOf(fetchImpl, 1).url).toBe('https://api.vercel.com/v6/domains/shop.acme.com/config');
  });

  it('reports pending verification without asking for the DNS config', async () => {
    const fetchImpl = stubFetch({ body: { verified: false } });
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('not verified yet');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a verified domain whose DNS Vercel calls misconfigured', async () => {
    const fetchImpl = stubFetch({ body: { verified: true } }, { body: { misconfigured: true } });
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('misconfigured');
  });

  it('reports a host that is not attached to the project (404)', async () => {
    const fetchImpl = stubFetch({ status: 404, body: { error: { code: 'not_found', message: 'nope' } } });
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('not attached');
  });

  it('rejects (never throws) on an auth failure, without echoing the token', async () => {
    const fetchImpl = stubFetch({
      status: 403,
      body: { error: { code: 'forbidden', message: 'Not authorized' } },
    });
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('VERCEL_TOKEN');
    expect(result.detail).not.toContain(TOKEN);
  });

  it('rejects (never throws) on a transport error', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('unreachable');
  });

  it('rejects on a corrupted domain payload', async () => {
    const fetchImpl = stubFetch({ raw: '<html>gateway timeout</html>' });
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('did not match');
  });

  it('rejects on a corrupted DNS-config payload', async () => {
    const fetchImpl = stubFetch({ body: { verified: true } }, { body: { misconfigured: 'maybe' } });
    const result = await port(fetchImpl).check('shop.acme.com');

    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('did not match');
  });
});
