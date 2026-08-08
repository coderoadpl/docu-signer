import { describe, expect, it } from 'vitest';

import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  canonicalSlugSchema,
  normalizeSlug,
  slugSchema,
} from './slug.js';

describe('normalizeSlug', () => {
  it('lowercases and trims', () => {
    expect(normalizeSlug('  Acme  ')).toBe('acme');
  });

  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(normalizeSlug('Acme   Corp!!!Inc')).toBe('acme-corp-inc');
  });

  it('strips leading and trailing hyphens', () => {
    expect(normalizeSlug('--Foo Bar--')).toBe('foo-bar');
  });

  it('reduces all-symbol input to an empty string', () => {
    expect(normalizeSlug('@#$%')).toBe('');
  });
});

describe('slugSchema', () => {
  it('normalizes free input then validates', () => {
    expect(slugSchema.parse('  Acme Corp  ')).toBe('acme-corp');
  });

  it('rejects input that normalizes below the minimum length', () => {
    expect(slugSchema.safeParse('ab').success).toBe(false);
  });

  it('rejects input that normalizes to empty', () => {
    expect(slugSchema.safeParse('   ').success).toBe(false);
  });

  it('rejects a reserved name', () => {
    expect(slugSchema.safeParse('Admin').success).toBe(false);
  });

  it('rejects every reserved name after normalization', () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(slugSchema.safeParse(reserved).success).toBe(false);
    }
  });
});

describe('canonicalSlugSchema', () => {
  it('accepts a canonical slug', () => {
    expect(canonicalSlugSchema.parse('acme-corp')).toBe('acme-corp');
  });

  it('rejects uppercase (no silent normalization)', () => {
    expect(canonicalSlugSchema.safeParse('Acme').success).toBe(false);
  });

  it('rejects consecutive hyphens', () => {
    expect(canonicalSlugSchema.safeParse('acme--corp').success).toBe(false);
  });

  it('rejects leading and trailing hyphens', () => {
    expect(canonicalSlugSchema.safeParse('-acme').success).toBe(false);
    expect(canonicalSlugSchema.safeParse('acme-').success).toBe(false);
  });

  it('rejects a slug over the maximum length', () => {
    expect(canonicalSlugSchema.safeParse('a'.repeat(SLUG_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('rejects a reserved name', () => {
    expect(canonicalSlugSchema.safeParse('api').success).toBe(false);
  });
});
