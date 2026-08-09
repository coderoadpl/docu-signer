import { describe, expect, it } from 'vitest';

import { tenantContentVersion, tenantDomainSchema, tenantSchema } from './tenant.js';

describe('tenant plumbing', () => {
  it('parses tenant and verified host-binding rows', () => {
    expect(tenantSchema.parse({ id: 't1', slug: 'default', name: 'Archive' })).toEqual({
      id: 't1',
      slug: 'default',
      name: 'Archive',
    });
    expect(
      tenantDomainSchema.parse({
        id: 'd1',
        tenantId: 't1',
        domain: 'archive.example.com',
        kind: 'custom',
        verified: true,
      }),
    ).toMatchObject({ tenantId: 't1', verified: true });
  });

  it('derives a stable public content version', () => {
    const tenant = { slug: 'default', name: 'Archive' };
    expect(tenantContentVersion(tenant)).toBe(tenantContentVersion(tenant));
    expect(tenantContentVersion({ ...tenant, name: 'Renamed' })).not.toBe(
      tenantContentVersion(tenant),
    );
  });
});
