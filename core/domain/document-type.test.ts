import { describe, expect, it } from 'vitest';

import {
  createDocumentTypeSchema,
  documentTypeDefinitionSchema,
  documentTypeSchema,
  renameDocumentTypeSchema,
} from './index.js';

describe('document type schemas', () => {
  it('accepts canonical tenant-defined slugs', () => {
    expect(documentTypeSchema.parse('umowa-z-klientem')).toBe('umowa-z-klientem');
    expect(documentTypeSchema.safeParse('Umowa z klientem').success).toBe(false);
    expect(documentTypeSchema.safeParse(`a${'-a'.repeat(32)}`).success).toBe(false);
  });

  it('trims labels and enforces their length', () => {
    expect(createDocumentTypeSchema.parse({ label: '  Umowa z klientem  ' })).toEqual({
      label: 'Umowa z klientem',
    });
    expect(renameDocumentTypeSchema.safeParse({ label: ' ' }).success).toBe(false);
    expect(renameDocumentTypeSchema.safeParse({ label: 'a'.repeat(101) }).success).toBe(false);
    expect(documentTypeDefinitionSchema.parse({
      slug: 'umowa-z-klientem',
      label: '  Umowa z klientem ',
      position: 60,
    })).toEqual({
      slug: 'umowa-z-klientem',
      label: 'Umowa z klientem',
      position: 60,
    });
  });
});
