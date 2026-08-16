import { describe, expect, it, vi } from 'vitest';

import type {
  Document,
  DocumentLink,
  Identity,
} from '#core/domain/index.js';

import type { DocumentLinkRepository, DocumentRepository } from '../ports.js';
import {
  approveDocumentLink,
  linkDocuments,
  listDocumentLinks,
  unlinkDocuments,
  type DocumentLinkDeps,
} from './document-links.js';

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';

const identity = (tenantId: string | null, staffRole: 'owner' | 'admin' | null): Identity => ({
  userId: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme' : null,
  staffRole,
  apiToken: null,
});

const document = (id: string, tenantId: string, title: string): Document => ({
  id,
  tenantId,
  title,
  docType: 'inny',
  documentDate: '2026-08-16',
  periodStart: null,
  periodEnd: null,
  person: null,
  tags: [],
  draft: false,
  signatureNotRequired: false,
  createdAt: '2026-08-16T10:00:00.000Z',
  updatedAt: '2026-08-16T10:00:00.000Z',
  deletedAt: null,
});

const documentRepository = (rows: Document[]): DocumentRepository => ({
  listByTenant: async () => [],
  listDeletedByTenant: async () => [],
  findById: async () => null,
  findDeletedById: async () => null,
  findAnyById: async (tenantId, documentId) =>
    rows.find((row) => row.tenantId === tenantId && row.id === documentId) ?? null,
  getPendingDraftCounts: async () => ({ comments: 0, links: 0, metadataProposals: 0 }),
  listFiles: async () => [],
  listFilesIncludingDeleted: async () => [],
  listAllFilesIncludingDeleted: async () => [],
  listFilesForDocuments: async () => [],
  create: async () => {
    throw new Error('not implemented');
  },
  update: async () => null,
  approve: async () => null,
  unapprove: async () => null,
  waiveSignature: async () => null,
  requireSignature: async () => null,
  delete: async () => false,
  restore: async () => null,
  purge: async () => false,
  createFile: async () => null,
  updateFileSize: async () => false,
  findFile: async () => null,
  moveFileToDocument: async () => null,
  deleteFile: async () => false,
});

const deps = (rows: Document[], initialLinks: DocumentLink[] = []): DocumentLinkDeps => {
  const links = [...initialLinks];
  const documents = documentRepository(rows);
  const documentLinks: DocumentLinkRepository = {
    create: async (tenantId, input) => {
      const duplicate = links.some(
        (link) =>
          link.tenantId === tenantId &&
          ((link.fromDocumentId === input.fromDocumentId &&
            link.toDocumentId === input.toDocumentId) ||
            (link.fromDocumentId === input.toDocumentId &&
              link.toDocumentId === input.fromDocumentId)),
      );
      if (duplicate) return null;
      const created = { tenantId, ...input };
      links.push(created);
      return created;
    },
    findBetween: async (tenantId, firstDocumentId, secondDocumentId) =>
      links.find(
        (link) =>
          link.tenantId === tenantId &&
          ((link.fromDocumentId === firstDocumentId &&
            link.toDocumentId === secondDocumentId) ||
            (link.fromDocumentId === secondDocumentId &&
              link.toDocumentId === firstDocumentId)),
      ) ?? null,
    listForDocument: async (tenantId, documentId) =>
      links
        .filter(
          (link) =>
            link.tenantId === tenantId &&
            (link.fromDocumentId === documentId || link.toDocumentId === documentId),
        )
        .map((link) => {
          const otherId = link.fromDocumentId === documentId
            ? link.toDocumentId
            : link.fromDocumentId;
          const other = rows.find((row) => row.tenantId === tenantId && row.id === otherId);
          if (!other) throw new Error('missing linked document');
          return { linkId: link.id, label: link.label, draft: link.draft, document: other };
        }),
    approve: async (tenantId, linkId) => {
      const link = links.find((candidate) => candidate.tenantId === tenantId && candidate.id === linkId);
      if (!link) return null;
      link.draft = false;
      return link;
    },
    deleteBetween: async (tenantId, firstDocumentId, secondDocumentId) => {
      const index = links.findIndex(
        (link) =>
          link.tenantId === tenantId &&
          ((link.fromDocumentId === firstDocumentId &&
            link.toDocumentId === secondDocumentId) ||
            (link.fromDocumentId === secondDocumentId &&
              link.toDocumentId === firstDocumentId)),
      );
      if (index < 0) return false;
      links.splice(index, 1);
      return true;
    },
  };
  return { documents, documentLinks, ids: { nextId: () => LINK_ID } };
};

const ctx = (value: Identity) => ({ identity: value });

describe('document link use-cases', () => {
  it('authorizes before any repository access', async () => {
    const state = deps([
      document(FIRST_ID, 'tenant-a', 'First'),
      document(SECOND_ID, 'tenant-a', 'Second'),
    ]);
    const documentRead = vi.spyOn(state.documents, 'findAnyById');
    const linkRead = vi.spyOn(state.documentLinks, 'findBetween');
    const linkList = vi.spyOn(state.documentLinks, 'listForDocument');
    const linkDelete = vi.spyOn(state.documentLinks, 'deleteBetween');
    const linkApprove = vi.spyOn(state.documentLinks, 'approve');
    const visitor = ctx(identity(null, null));

    await expect(
      linkDocuments(visitor, FIRST_ID, { otherDocumentId: SECOND_ID }, state),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(unlinkDocuments(visitor, FIRST_ID, SECOND_ID, state)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(listDocumentLinks(visitor, FIRST_ID, state)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(approveDocumentLink(visitor, LINK_ID, state)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(documentRead).not.toHaveBeenCalled();
    expect(linkRead).not.toHaveBeenCalled();
    expect(linkList).not.toHaveBeenCalled();
    expect(linkDelete).not.toHaveBeenCalled();
    expect(linkApprove).not.toHaveBeenCalled();
  });

  it('returns not_found when either document is outside the tenant', async () => {
    const state = deps([
      document(FIRST_ID, 'tenant-a', 'First'),
      document(SECOND_ID, 'tenant-b', 'Second'),
    ]);
    await expect(
      linkDocuments(
        ctx(identity('tenant-a', 'owner')),
        FIRST_ID,
        { otherDocumentId: SECOND_ID },
        state,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects self-links before repository access', async () => {
    const state = deps([document(FIRST_ID, 'tenant-a', 'First')]);
    const documentRead = vi.spyOn(state.documents, 'findAnyById');
    await expect(
      linkDocuments(
        ctx(identity('tenant-a', 'owner')),
        FIRST_ID,
        { otherDocumentId: FIRST_ID },
        state,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(documentRead).not.toHaveBeenCalled();
  });

  it('rejects invalid labels and reports an insert-race duplicate as conflict', async () => {
    const rows = [
      document(FIRST_ID, 'tenant-a', 'First'),
      document(SECOND_ID, 'tenant-a', 'Second'),
    ];
    const state = deps(rows);
    const owner = ctx(identity('tenant-a', 'owner'));
    const documentRead = vi.spyOn(state.documents, 'findAnyById');
    await expect(
      linkDocuments(
        owner,
        FIRST_ID,
        { otherDocumentId: SECOND_ID, label: 'x'.repeat(61) },
        state,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(documentRead).not.toHaveBeenCalled();

    vi.spyOn(state.documentLinks, 'create').mockResolvedValue(null);
    await expect(
      linkDocuments(owner, FIRST_ID, { otherDocumentId: SECOND_ID }, state),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('stores a reverse request in canonical document order', async () => {
    const state = deps([
      document(FIRST_ID, 'tenant-a', 'First'),
      document(SECOND_ID, 'tenant-a', 'Second'),
    ]);
    const create = vi.spyOn(state.documentLinks, 'create');
    await expect(
      linkDocuments(
        ctx(identity('tenant-a', 'owner')),
        SECOND_ID,
        { otherDocumentId: FIRST_ID },
        state,
      ),
    ).resolves.toMatchObject({ ok: true, value: { document: { id: FIRST_ID } } });
    expect(create).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ fromDocumentId: FIRST_ID, toDocumentId: SECOND_ID }),
    );
  });

  it('marks draft-token links as drafts and session or full-token links as approved', async () => {
    const rows = [
      document(FIRST_ID, 'tenant-a', 'First'),
      document(SECOND_ID, 'tenant-a', 'Second'),
    ];
    const draftToken = {
      ...identity('tenant-a', 'owner'),
      apiToken: { id: 'token-draft', scopes: ['write:draft'] as const },
    };
    const fullToken = {
      ...identity('tenant-a', 'owner'),
      apiToken: { id: 'token-write', scopes: ['write', 'write:draft'] as const },
    };
    const draftState = deps(rows);
    const sessionState = deps(rows);
    const fullTokenState = deps(rows);

    await expect(
      linkDocuments(ctx(draftToken), FIRST_ID, { otherDocumentId: SECOND_ID }, draftState),
    ).resolves.toMatchObject({ ok: true, value: { draft: true } });
    await expect(
      linkDocuments(
        ctx(identity('tenant-a', 'owner')),
        FIRST_ID,
        { otherDocumentId: SECOND_ID },
        sessionState,
      ),
    ).resolves.toMatchObject({ ok: true, value: { draft: false } });
    await expect(
      linkDocuments(ctx(fullToken), FIRST_ID, { otherDocumentId: SECOND_ID }, fullTokenState),
    ).resolves.toMatchObject({ ok: true, value: { draft: false } });
  });

  it('approves links idempotently with document approval capability', async () => {
    const state = deps(
      [
        document(FIRST_ID, 'tenant-a', 'First'),
        document(SECOND_ID, 'tenant-a', 'Second'),
      ],
      [{
        id: LINK_ID,
        tenantId: 'tenant-a',
        fromDocumentId: FIRST_ID,
        toDocumentId: SECOND_ID,
        label: null,
        draft: true,
      }],
    );
    const owner = ctx(identity('tenant-a', 'owner'));

    await expect(approveDocumentLink(owner, LINK_ID, state)).resolves.toMatchObject({
      ok: true,
      value: { id: LINK_ID, draft: false },
    });
    await expect(approveDocumentLink(owner, LINK_ID, state)).resolves.toMatchObject({
      ok: true,
      value: { id: LINK_ID, draft: false },
    });
  });

  it('validates approval ids and returns not found for missing links', async () => {
    const state = deps([]);
    const owner = ctx(identity('tenant-a', 'owner'));

    await expect(approveDocumentLink(owner, 'invalid', state)).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    await expect(approveDocumentLink(owner, LINK_ID, state)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('trims labels, lists both directions, rejects duplicates, and unlinks', async () => {
    const rows = [
      document(FIRST_ID, 'tenant-a', 'First'),
      document(SECOND_ID, 'tenant-a', 'Second'),
    ];
    const state = deps(rows);
    const owner = ctx(identity('tenant-a', 'owner'));
    await expect(
      linkDocuments(owner, FIRST_ID, { otherDocumentId: SECOND_ID, label: ' podstawa ' }, state),
    ).resolves.toMatchObject({
      ok: true,
      value: { label: 'podstawa', document: { id: SECOND_ID } },
    });
    await expect(
      linkDocuments(owner, SECOND_ID, { otherDocumentId: FIRST_ID }, state),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
    await expect(listDocumentLinks(owner, SECOND_ID, state)).resolves.toMatchObject({
      ok: true,
      value: [{ label: 'podstawa', document: { id: FIRST_ID } }],
    });
    await expect(unlinkDocuments(owner, SECOND_ID, FIRST_ID, state)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(listDocumentLinks(owner, FIRST_ID, state)).resolves.toEqual({
      ok: true,
      value: [],
    });
  });
});
