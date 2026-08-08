import { describe, expect, it } from 'vitest';

import { publicCacheControl } from './cache.js';

describe('publicCacheControl', () => {
  it('emits the architecture §HTTP caching shape for the profile route', () => {
    expect(publicCacheControl('profile')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    );
  });

  it('emits a shorter s-maxage for the discovery route', () => {
    expect(publicCacheControl('discovery')).toBe(
      'public, max-age=0, s-maxage=30, stale-while-revalidate=30',
    );
  });

  it('always pins max-age=0 so the browser revalidates every profile', () => {
    for (const profile of ['discovery', 'profile'] as const) {
      expect(publicCacheControl(profile)).toContain('public, max-age=0, s-maxage=');
    }
  });
});
