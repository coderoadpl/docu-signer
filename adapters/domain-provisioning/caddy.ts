import { resolve4, resolveCname } from 'node:dns/promises';

import type { DomainCheck, DomainPort } from '#core/server/index.js';

/** The DNS surface the check needs, injected so tests drive it without a network. */
export interface DomainResolver {
  resolveCname(domain: string): Promise<string[]>;
  resolve4(domain: string): Promise<string[]>;
}

export interface CaddyDomainPortConfig {
  /** The CNAME tenants point their domain at (e.g. `apps.example.com`). */
  readonly targetCname?: string | undefined;
  /** The A record tenants point their domain at, when a CNAME is not used. */
  readonly targetIp?: string | undefined;
  readonly resolver?: DomainResolver | undefined;
}

const nodeResolver: DomainResolver = { resolveCname, resolve4 };

/** Trailing-dot- and case-insensitive host comparison. */
const sameHost = (a: string, b: string): boolean =>
  a.replace(/\.$/, '').toLowerCase() === b.replace(/\.$/, '').toLowerCase();

const rejected = (detail: string): DomainCheck => ({ resolved: false, detail });

/**
 * Caddy on-demand TLS DomainPort. Provisioning is Caddy's job (it issues a cert
 * the first TLS handshake a domain's `ask` check approves), so `provision` and
 * `remove` are no-ops; `check` verifies the operator-facing precondition — that
 * the tenant actually pointed DNS at this deploy — before we tell them it is set.
 */
export const createCaddyDomainPort = (config: CaddyDomainPortConfig): DomainPort => {
  const resolver = config.resolver ?? nodeResolver;
  return {
    provision: async () => {},
    remove: async () => {},
    check: async (domain) => {
      if (config.targetCname) {
        const cnames = await resolver.resolveCname(domain).catch((): string[] => []);
        const match = cnames.some((cname) => sameHost(cname, config.targetCname ?? ''));
        return match
          ? { resolved: true, detail: `${domain} is a CNAME to ${config.targetCname}` }
          : rejected(
              `${domain} does not CNAME to ${config.targetCname} (found: ${cnames.join(', ') || 'none'})`,
            );
      }
      if (config.targetIp) {
        const ips = await resolver.resolve4(domain).catch((): string[] => []);
        const match = ips.includes(config.targetIp);
        return match
          ? { resolved: true, detail: `${domain} resolves to ${config.targetIp}` }
          : rejected(`${domain} does not resolve to ${config.targetIp} (found: ${ips.join(', ') || 'none'})`);
      }
      return rejected('No SELF_HOST_TARGET_CNAME or SELF_HOST_TARGET_IP configured');
    },
  };
};
