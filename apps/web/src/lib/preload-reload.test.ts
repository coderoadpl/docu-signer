import { describe, expect, it } from 'vitest';

import { shouldReloadAfterPreloadError } from './preload-reload.js';

describe('shouldReloadAfterPreloadError', () => {
  it('allows the first reload', () => {
    expect(shouldReloadAfterPreloadError(null, 10_000)).toBe(true);
  });

  it('blocks another reload within 30 seconds', () => {
    expect(shouldReloadAfterPreloadError(10_000, 39_999)).toBe(false);
  });

  it('allows another reload after 30 seconds', () => {
    expect(shouldReloadAfterPreloadError(10_000, 40_000)).toBe(true);
  });

  it('allows recovery from an invalid stored timestamp', () => {
    expect(shouldReloadAfterPreloadError(Number.NaN, 10_000)).toBe(true);
  });
});
