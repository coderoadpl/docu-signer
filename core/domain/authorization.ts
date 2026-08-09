import type { Identity } from './identity.js';

export const CAPABILITIES = ['document:read', 'document:write'] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type Principal = 'owner' | 'admin' | 'visitor';

export type Verdict = { allowed: true } | { allowed: false; reason: string };

export const principalOf = (identity: Identity): Principal =>
  identity.staffRole ?? 'visitor';

const GRANTS: Record<Capability, readonly Principal[]> = {
  'document:read': ['owner', 'admin'],
  'document:write': ['owner', 'admin'],
};

export const decide = (identity: Identity, capability: Capability): Verdict => {
  const principal = principalOf(identity);
  return GRANTS[capability].includes(principal)
    ? { allowed: true }
    : { allowed: false, reason: `${capability} is not permitted for ${principal}` };
};
