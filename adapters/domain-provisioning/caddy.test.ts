import { describe, expect, it, vi } from 'vitest';

import type { DomainResolver } from './caddy.js';
import { createCaddyDomainPort } from './caddy.js';
import { createNoopDomainPort } from './noop.js';

const resolver = (over: Partial<DomainResolver>): DomainResolver => ({
  resolveCname: async () => [],
  resolve4: async () => [],
  ...over,
});

describe('createCaddyDomainPort — provision/remove', () => {
  it('provision and remove are no-ops (Caddy self-provisions on demand)', async () => {
    const port = createCaddyDomainPort({ targetCname: 'apps.example.com' });
    await expect(port.provision('shop.acme.com')).resolves.toBeUndefined();
    await expect(port.remove('shop.acme.com')).resolves.toBeUndefined();
  });
});

describe('createCaddyDomainPort — CNAME check', () => {
  it('resolves when the domain CNAMEs to the target (dot/case-insensitive)', async () => {
    const port = createCaddyDomainPort({
      targetCname: 'apps.example.com',
      resolver: resolver({ resolveCname: async () => ['Apps.Example.com.'] }),
    });
    const result = await port.check('shop.acme.com');
    expect(result.resolved).toBe(true);
    expect(result.detail).toContain('apps.example.com');
  });

  it('rejects when the CNAME points elsewhere', async () => {
    const port = createCaddyDomainPort({
      targetCname: 'apps.example.com',
      resolver: resolver({ resolveCname: async () => ['other.host.com'] }),
    });
    const result = await port.check('shop.acme.com');
    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('other.host.com');
  });

  it('rejects (never throws) when the DNS lookup fails', async () => {
    const port = createCaddyDomainPort({
      targetCname: 'apps.example.com',
      resolver: resolver({
        resolveCname: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    });
    const result = await port.check('shop.acme.com');
    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('none');
  });
});

describe('createCaddyDomainPort — A-record check', () => {
  it('resolves when an A record matches the configured IP', async () => {
    const port = createCaddyDomainPort({
      targetIp: '203.0.113.10',
      resolver: resolver({ resolve4: async () => ['198.51.100.1', '203.0.113.10'] }),
    });
    expect((await port.check('shop.acme.com')).resolved).toBe(true);
  });

  it('rejects when no A record matches', async () => {
    const port = createCaddyDomainPort({
      targetIp: '203.0.113.10',
      resolver: resolver({ resolve4: async () => ['198.51.100.1'] }),
    });
    expect((await port.check('shop.acme.com')).resolved).toBe(false);
  });

  it('prefers the CNAME target when both are configured', async () => {
    const resolve4 = vi.fn(async () => ['203.0.113.10']);
    const port = createCaddyDomainPort({
      targetCname: 'apps.example.com',
      targetIp: '203.0.113.10',
      resolver: resolver({ resolveCname: async () => ['apps.example.com'], resolve4 }),
    });
    expect((await port.check('shop.acme.com')).resolved).toBe(true);
    expect(resolve4).not.toHaveBeenCalled();
  });
});

describe('createCaddyDomainPort — misconfiguration', () => {
  it('rejects with a config hint when no target is set', async () => {
    const result = await createCaddyDomainPort({}).check('shop.acme.com');
    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('SELF_HOST_TARGET');
  });
});

describe('createNoopDomainPort', () => {
  it('accepts every domain and no-ops provision/remove', async () => {
    const port = createNoopDomainPort();
    await expect(port.provision('x.com')).resolves.toBeUndefined();
    await expect(port.remove('x.com')).resolves.toBeUndefined();
    expect((await port.check('x.com')).resolved).toBe(true);
  });
});
