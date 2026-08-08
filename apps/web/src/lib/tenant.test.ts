import { afterEach, describe, expect, it } from 'vitest';

import { tenantHue, tenantUrl } from './tenant.js';

const originalLocation = window.location;

const setLocation = (location: { protocol: string; hostname: string; port: string }) => {
  Object.defineProperty(window, 'location', { configurable: true, value: location });
};

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('tenantUrl', () => {
  it('swaps the subdomain and preserves protocol and port', () => {
    setLocation({ protocol: 'http:', hostname: 'acme.localhost', port: '47100' });

    expect(tenantUrl('globex')).toBe('http://globex.localhost:47100');
  });

  it('keeps a multi-label base domain and omits an empty port', () => {
    setLocation({ protocol: 'https:', hostname: 'acme.example.com', port: '' });

    expect(tenantUrl('globex')).toBe('https://globex.example.com');
  });

  it('prefixes a bare single-label hostname without dropping it', () => {
    setLocation({ protocol: 'https:', hostname: 'localhost', port: '' });

    expect(tenantUrl('globex')).toBe('https://globex.localhost');
  });

  it('returns null on the shared vercel.app apex — sibling subdomains are strangers', () => {
    setLocation({ protocol: 'https:', hostname: 'agentproofarch.vercel.app', port: '' });

    expect(tenantUrl('acme')).toBeNull();
    expect(tenantUrl('globex')).toBeNull();
  });
});

describe('tenantHue', () => {
  it('is deterministic and lands inside the hue circle', () => {
    const hue = tenantHue('acme');

    expect(hue).toBe(tenantHue('acme'));
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it('separates distinct slugs', () => {
    expect(tenantHue('acme')).not.toBe(tenantHue('globex'));
  });
});
