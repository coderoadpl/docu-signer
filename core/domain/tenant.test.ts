import { describe, expect, it } from 'vitest';

import {
  membershipSchema,
  publicTenantProfileSchema,
  tenantContentVersion,
  tenantDomainSchema,
  tenantSchema,
} from './tenant.js';

describe('tenantSchema', () => {
  const valid = { id: 't1', slug: 'acme', name: 'Acme Inc' };

  it('parses a valid tenant', () => {
    expect(tenantSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a missing field', () => {
    expect(tenantSchema.safeParse({ id: 't1', slug: 'acme' }).success).toBe(false);
  });

  it('rejects a non-string field', () => {
    expect(tenantSchema.safeParse({ ...valid, name: 42 }).success).toBe(false);
  });
});

describe('membershipSchema', () => {
  it('parses a valid membership', () => {
    const valid = { tenant: { id: 't1', slug: 'acme', name: 'Acme Inc' }, staffRole: 'owner' };
    expect(membershipSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown staff role', () => {
    const invalid = { tenant: { id: 't1', slug: 'acme', name: 'Acme Inc' }, staffRole: 'guest' };
    expect(membershipSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('tenantDomainSchema', () => {
  const valid = {
    id: 'd1',
    tenantId: 't1',
    domain: 'acme.example.com',
    kind: 'custom',
    verified: true,
  };

  it('parses a valid tenant domain', () => {
    expect(tenantDomainSchema.parse(valid)).toEqual(valid);
  });

  it('accepts the subdomain kind', () => {
    expect(tenantDomainSchema.parse({ ...valid, kind: 'subdomain' }).kind).toBe('subdomain');
  });

  it('rejects an unknown kind', () => {
    expect(tenantDomainSchema.safeParse({ ...valid, kind: 'apex' }).success).toBe(false);
  });

  it('rejects a non-boolean verified', () => {
    expect(tenantDomainSchema.safeParse({ ...valid, verified: 'yes' }).success).toBe(false);
  });
});

describe('publicTenantProfileSchema', () => {
  it('parses a profile carrying only the safe public fields', () => {
    const valid = { slug: 'acme', displayName: 'Acme Inc', contentVersion: 'abc123' };
    expect(publicTenantProfileSchema.parse(valid)).toEqual(valid);
  });

  it('strips any unsafe field that slips in (id, email, members)', () => {
    const parsed = publicTenantProfileSchema.parse({
      slug: 'acme',
      displayName: 'Acme Inc',
      contentVersion: 'abc123',
      id: 'tenant-secret',
      email: 'owner@acme.test',
    });
    expect(parsed).toEqual({ slug: 'acme', displayName: 'Acme Inc', contentVersion: 'abc123' });
    expect('id' in parsed).toBe(false);
  });
});

describe('tenantContentVersion', () => {
  it('is deterministic for the same visible content', () => {
    const input = { slug: 'acme', name: 'Acme Inc' };
    expect(tenantContentVersion(input)).toBe(tenantContentVersion(input));
  });

  it('changes when the display name changes (a rename busts the cache key)', () => {
    expect(tenantContentVersion({ slug: 'acme', name: 'Acme Inc' })).not.toBe(
      tenantContentVersion({ slug: 'acme', name: 'Acme LLC' }),
    );
  });

  it('changes when the slug changes', () => {
    expect(tenantContentVersion({ slug: 'acme', name: 'Acme Inc' })).not.toBe(
      tenantContentVersion({ slug: 'globex', name: 'Acme Inc' }),
    );
  });

  it('does not collide across the slug/name boundary', () => {
    expect(tenantContentVersion({ slug: 'ab', name: 'c' })).not.toBe(
      tenantContentVersion({ slug: 'a', name: 'bc' }),
    );
  });

  it('emits a URL-safe base36 token', () => {
    expect(tenantContentVersion({ slug: 'acme', name: 'Acme Inc' })).toMatch(/^[a-z0-9]+$/);
  });
});
