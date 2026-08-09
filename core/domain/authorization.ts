import type { Identity } from './identity.js';

export const CAPABILITIES = [
  'document:read',
  'document:write',
  'document:approve',
  'api-token:manage',
  'saved-search:manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type Principal = 'owner' | 'admin' | 'visitor';

export type Verdict = { allowed: true } | { allowed: false; reason: string };

export const principalOf = (identity: Identity): Principal =>
  identity.staffRole ?? 'visitor';

const GRANTS: Record<Capability, readonly Principal[]> = {
  'document:read': ['owner', 'admin'],
  'document:write': ['owner', 'admin'],
  'document:approve': ['owner', 'admin'],
  'api-token:manage': ['owner', 'admin'],
  'saved-search:manage': ['owner', 'admin'],
};

const tokenAllows = (identity: Identity, capability: Capability): Verdict => {
  if (identity.apiToken === null) return { allowed: true };
  const scopes = identity.apiToken.scopes;
  if (capability === 'document:read' && scopes.includes('read')) return { allowed: true };
  if (
    capability === 'document:write' &&
    (scopes.includes('write') || scopes.includes('write:draft'))
  ) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `${capability} is not permitted for API token scope`,
  };
};

export const decide = (identity: Identity, capability: Capability): Verdict => {
  const principal = principalOf(identity);
  if (!GRANTS[capability].includes(principal)) {
    return { allowed: false, reason: `${capability} is not permitted for ${principal}` };
  }
  return tokenAllows(identity, capability);
};
