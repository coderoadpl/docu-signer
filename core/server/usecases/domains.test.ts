import { describe, expect, it } from 'vitest';

import type { Identity, TenantDomain } from '#core/domain/index.js';

import type { DomainPort, TenantDomainRepository } from '../ports.js';
import {
  addDomain,
  checkDomain,
  listDomains,
  removeDomain,
  type DomainDeps,
} from './domains.js';

const identity = (over: Partial<Identity> = {}): Identity => ({
  userId: 'u-owner',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: 'owner',
  memberId: null,
  ...over,
});

const owner = identity();
const admin = identity({ userId: 'u-admin', staffRole: 'admin' });
const member = identity({ userId: 'u-cust', staffRole: null, memberId: 'm-1' });
const visitor = identity({
  userId: 'u-visitor',
  staffRole: null,
  memberId: null,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
});

const fakes = (seed: TenantDomain[] = [], resolved = true) => {
  let store = [...seed];
  const tenantDomains: TenantDomainRepository = {
    findByDomain: async (domain) => store.find((d) => d.domain === domain && d.verified) ?? null,
    listVerifiedDomains: async () => store.filter((d) => d.verified),
    listByTenant: async (tenantId) => store.filter((d) => d.tenantId === tenantId),
    findAnyByDomain: async (domain) => store.find((d) => d.domain === domain) ?? null,
    findByTenantAndDomain: async (tenantId, domain) =>
      store.find((d) => d.tenantId === tenantId && d.domain === domain) ?? null,
    add: async (input) => {
      store.push(input);
      return input;
    },
    setVerified: async (tenantId, domain, verified) => {
      const row = store.find((d) => d.tenantId === tenantId && d.domain === domain);
      if (!row) return null;
      row.verified = verified;
      return row;
    },
    removeByTenantAndDomain: async (tenantId, domain) => {
      const before = store.length;
      store = store.filter((d) => !(d.tenantId === tenantId && d.domain === domain));
      return before - store.length;
    },
  };
  const provisioned: string[] = [];
  const removed: string[] = [];
  const domainPort: DomainPort = {
    provision: async (domain) => {
      provisioned.push(domain);
    },
    remove: async (domain) => {
      removed.push(domain);
    },
    check: async (domain) => ({ resolved, detail: `${domain} ${resolved ? 'ok' : 'no'}` }),
  };
  const deps: DomainDeps = {
    tenantDomains,
    domainPort,
    ids: { nextId: () => 'domain-new' },
    domainTarget: { cname: 'apps.example.com', ip: null },
  };
  return { deps, store: () => store, provisioned, removed };
};

const seededDomain = (over: Partial<TenantDomain> = {}): TenantDomain => ({
  id: 'd-1',
  tenantId: 't-acme',
  domain: 'shop.acme.com',
  kind: 'custom',
  verified: false,
  ...over,
});

describe('domain use-cases — authorization matrix', () => {
  it('listDomains is readable by owner AND admin, forbidden to member and visitor', async () => {
    const { deps } = fakes([seededDomain()]);
    expect((await listDomains({ identity: owner, tenantCreationMode: 'open' }, deps)).ok).toBe(true);
    expect((await listDomains({ identity: admin, tenantCreationMode: 'open' }, deps)).ok).toBe(true);
    expect(await listDomains({ identity: member, tenantCreationMode: 'open' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await listDomains({ identity: visitor, tenantCreationMode: 'open' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('addDomain is owner-only: an admin is forbidden before any write', async () => {
    const { deps, store } = fakes();
    expect(await addDomain({ identity: admin, tenantCreationMode: 'open' }, { domain: 'shop.acme.com' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(store()).toHaveLength(0);
  });

  it('checkDomain and removeDomain are owner-only (admin forbidden)', async () => {
    const { deps } = fakes([seededDomain()]);
    expect(await checkDomain({ identity: admin, tenantCreationMode: 'open' }, { domain: 'shop.acme.com' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await removeDomain({ identity: admin, tenantCreationMode: 'open' }, { domain: 'shop.acme.com' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});

describe('addDomain', () => {
  it('attaches a normalized custom domain unverified and provisions it', async () => {
    const { deps, store, provisioned } = fakes();
    const result = await addDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'HTTPS://Shop.Acme.com/' }, deps);
    expect(result).toMatchObject({ ok: true, value: { domain: 'shop.acme.com', verified: false } });
    expect(store()).toHaveLength(1);
    expect(provisioned).toEqual(['shop.acme.com']);
  });

  it('rejects a bare word that is not a fully-qualified domain (validation)', async () => {
    const { deps } = fakes();
    expect(await addDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'localhost' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('refuses a domain already attached anywhere with conflict', async () => {
    const { deps, store } = fakes([seededDomain({ verified: true })]);
    expect(await addDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'shop.acme.com' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(store()).toHaveLength(1);
  });
});

describe('checkDomain', () => {
  it('flips verified true when the provisioner resolves the domain', async () => {
    const { deps } = fakes([seededDomain()], true);
    const result = await checkDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'shop.acme.com' }, deps);
    expect(result).toMatchObject({ ok: true, value: { domain: { verified: true } } });
  });

  it('keeps verified false when the provisioner does not resolve the domain', async () => {
    const { deps } = fakes([seededDomain({ verified: true })], false);
    const result = await checkDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'shop.acme.com' }, deps);
    expect(result).toMatchObject({ ok: true, value: { domain: { verified: false } } });
  });

  it('returns not_found for a domain not attached to this tenant', async () => {
    const { deps } = fakes();
    expect(await checkDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'other.example.com' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('removeDomain', () => {
  it('detaches a domain and releases it through the provisioner', async () => {
    const { deps, store, removed } = fakes([seededDomain()]);
    const result = await removeDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'shop.acme.com' }, deps);
    expect(result).toMatchObject({ ok: true, value: { domain: 'shop.acme.com', removed: 1 } });
    expect(store()).toHaveLength(0);
    expect(removed).toEqual(['shop.acme.com']);
  });

  it('returns not_found when the domain is not this tenant’s', async () => {
    const { deps } = fakes();
    expect(await removeDomain({ identity: owner, tenantCreationMode: 'open' }, { domain: 'ghost.example.com' }, deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});
