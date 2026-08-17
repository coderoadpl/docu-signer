import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DOCUMENT_TYPES,
  type DocumentType,
  type Identity,
} from '#core/domain/index.js';

import type { DocumentTypeRepository } from '../ports.js';
import {
  createDocumentType,
  deleteDocumentType,
  documentTypeSlugFromLabel,
  listDocumentTypes,
  renameDocumentType,
  setDocumentTypeHidden,
} from './document-types.js';

const identity = (tenantId: string | null, role: 'owner' | 'admin' | null = 'owner'): Identity => ({
  userId: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId,
  tenantSlug: tenantId ? 'default' : null,
  tenantName: tenantId ? 'Archive' : null,
  staffRole: tenantId ? role : null,
  apiToken: null,
});

const repository = (
  initial: readonly DocumentType[] = DEFAULT_DOCUMENT_TYPES,
): DocumentTypeRepository => {
  const rows = initial.map((documentType) => ({ ...documentType }));
  return {
    listByTenant: async () => [...rows],
    findBySlug: async (_tenantId, slug) =>
      rows.find((documentType) => documentType.slug === slug) ?? null,
    create: async (input) => {
      if (rows.some((documentType) => documentType.slug === input.slug)) return null;
      const created = {
        slug: input.slug,
        label: input.label,
        position: input.position,
        hidden: input.hidden,
      };
      rows.push(created);
      return created;
    },
    rename: async (_tenantId, slug, label) => {
      const found = rows.find((documentType) => documentType.slug === slug);
      if (!found) return null;
      found.label = label;
      return found;
    },
    setHidden: async (_tenantId, slug, hidden) => {
      const found = rows.find((documentType) => documentType.slug === slug);
      if (!found) return null;
      found.hidden = hidden;
      return found;
    },
    delete: async (_tenantId, slug) => {
      const index = rows.findIndex((documentType) => documentType.slug === slug);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
    isUsedByAnyDocument: async () => false,
  };
};

describe('document type use-cases', () => {
  it('authorizes before accessing the repository', async () => {
    const documentTypes = repository();
    const spies = [
      vi.spyOn(documentTypes, 'listByTenant'),
      vi.spyOn(documentTypes, 'findBySlug'),
      vi.spyOn(documentTypes, 'create'),
      vi.spyOn(documentTypes, 'rename'),
      vi.spyOn(documentTypes, 'setHidden'),
      vi.spyOn(documentTypes, 'delete'),
      vi.spyOn(documentTypes, 'isUsedByAnyDocument'),
    ];
    const deps = { documentTypes };
    const ctx = { identity: identity(null, null) };

    await expect(listDocumentTypes(ctx, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(createDocumentType(ctx, { label: 'Nowy' }, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(renameDocumentType(ctx, 'inny', { label: 'Nowa' }, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(
      setDocumentTypeHidden(ctx, 'inny', { hidden: true }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(deleteDocumentType(ctx, 'inny', deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('lists types and derives a diacritic-free slug with the next position', async () => {
    const documentTypes = repository();
    const deps = { documentTypes };
    const ctx = { identity: identity('tenant-default') };

    await expect(listDocumentTypes(ctx, deps)).resolves.toMatchObject({
      ok: true,
      value: DEFAULT_DOCUMENT_TYPES,
    });
    await expect(createDocumentType(ctx, { label: '  Łączna Umowa Żółć  ' }, deps)).resolves.toEqual({
      ok: true,
      value: { slug: 'laczna-umowa-zolc', label: 'Łączna Umowa Żółć', position: 60, hidden: false },
    });
    expect(documentTypeSlugFromLabel('Umowa z klientem')).toBe('umowa-z-klientem');
  });

  it('rejects derived collisions and labels that cannot form a slug', async () => {
    const documentTypes = repository();
    const deps = { documentTypes };
    const ctx = { identity: identity('tenant-default') };

    await expect(createDocumentType(ctx, { label: 'Protokół' }, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    await expect(createDocumentType(ctx, { label: '!!!' }, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('renames only the label and reports a missing slug', async () => {
    const documentTypes = repository();
    const deps = { documentTypes };
    const ctx = { identity: identity('tenant-default', 'admin') };

    await expect(renameDocumentType(ctx, 'inny', { label: 'Pozostałe' }, deps)).resolves.toEqual({
      ok: true,
      value: { slug: 'inny', label: 'Pozostałe', position: 50, hidden: false },
    });
    await expect(renameDocumentType(ctx, 'brak', { label: 'Brak' }, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('hides and restores a type idempotently and reports a missing slug', async () => {
    const documentTypes = repository();
    const deps = { documentTypes };
    const ctx = { identity: identity('tenant-default') };

    await expect(
      setDocumentTypeHidden(ctx, 'rachunek', { hidden: true }, deps),
    ).resolves.toEqual({
      ok: true,
      value: { slug: 'rachunek', label: 'Rachunek', position: 40, hidden: true },
    });
    await expect(
      setDocumentTypeHidden(ctx, 'rachunek', { hidden: true }, deps),
    ).resolves.toMatchObject({ ok: true, value: { hidden: true } });
    await expect(
      setDocumentTypeHidden(ctx, 'rachunek', { hidden: false }, deps),
    ).resolves.toMatchObject({ ok: true, value: { hidden: false } });
    await expect(
      setDocumentTypeHidden(ctx, 'brak', { hidden: true }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(
      setDocumentTypeHidden(ctx, 'NIE poprawny slug', { hidden: true }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('blocks deletion while any document uses the slug', async () => {
    const documentTypes = repository();
    documentTypes.isUsedByAnyDocument = async () => true;
    const deleteSpy = vi.spyOn(documentTypes, 'delete');

    await expect(
      deleteDocumentType(
        { identity: identity('tenant-default') },
        'inny',
        { documentTypes },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('deletes unused types and reports missing ones', async () => {
    const documentTypes = repository();
    const deps = { documentTypes };
    const ctx = { identity: identity('tenant-default') };

    await expect(deleteDocumentType(ctx, 'inny', deps)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(deleteDocumentType(ctx, 'inny', deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});
