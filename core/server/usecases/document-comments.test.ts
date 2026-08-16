import { describe, expect, it, vi } from 'vitest';

import type {
  Document,
  DocumentComment,
  DocumentCommentListItem,
  Identity,
} from '#core/domain/index.js';
import type {
  DocumentCommentRepository,
  DocumentRepository,
} from '../ports.js';
import {
  addDocumentComment,
  deleteDocumentComment,
  listDocumentComments,
  type DocumentCommentDeps,
} from './document-comments.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';
const NEXT_COMMENT_ID = '33333333-3333-4333-8333-333333333333';

const identity = (
  userId = 'user-owner',
  tenantId: string | null = 'tenant-1',
  staffRole: 'owner' | 'admin' | null = 'owner',
): Identity => ({
  userId,
  email: `${userId}@example.com`,
  name: userId === 'user-owner' ? 'Owner' : 'Other',
  tenantId,
  tenantSlug: tenantId ? 'default' : null,
  tenantName: tenantId ? 'Default' : null,
  staffRole,
  apiToken: null,
});

const document: Document = {
  id: DOCUMENT_ID,
  tenantId: 'tenant-1',
  title: 'Umowa',
  docType: 'umowa-uod',
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
};

const documentRepository = (): DocumentRepository => ({
  listByTenant: async () => [],
  listDeletedByTenant: async () => [],
  findById: async (tenantId, documentId) =>
    tenantId === document.tenantId && documentId === document.id ? document : null,
  findDeletedById: async () => null,
  findAnyById: async (tenantId, documentId) =>
    tenantId === document.tenantId && documentId === document.id ? document : null,
  listFiles: async () => [],
  listFilesIncludingDeleted: async () => [],
  listAllFilesIncludingDeleted: async () => [],
  listFilesForDocuments: async () => [],
  create: async () => document,
  update: async () => document,
  approve: async () => document,
  unapprove: async () => document,
  waiveSignature: async () => document,
  requireSignature: async () => document,
  delete: async () => true,
  restore: async () => document,
  purge: async () => true,
  createFile: async () => null,
  updateFileSize: async () => false,
  findFile: async () => null,
  moveFileToDocument: async () => null,
  deleteFile: async () => false,
});

const rawComment = (authorAccountId = 'user-owner'): DocumentComment => ({
  id: COMMENT_ID,
  tenantId: 'tenant-1',
  documentId: DOCUMENT_ID,
  authorAccountId,
  body: 'Treść komentarza',
  createdAt: '2026-08-16T10:00:00.000Z',
});

const listItem = (authorAccountId = 'user-owner'): DocumentCommentListItem => ({
  id: COMMENT_ID,
  tenantId: 'tenant-1',
  documentId: DOCUMENT_ID,
  author: {
    accountId: authorAccountId,
    name: authorAccountId === 'user-owner' ? 'Owner' : 'Other',
  },
  body: 'Treść komentarza',
  createdAt: '2026-08-16T10:00:00.000Z',
});

const commentRepository = (
  authorAccountId = 'user-owner',
): DocumentCommentRepository => ({
  listByDocument: async () => [listItem(authorAccountId)],
  create: async (input) => ({
    id: input.id,
    tenantId: input.tenantId,
    documentId: input.documentId,
    author: {
      accountId: input.authorAccountId,
      name: input.authorAccountId === 'user-owner' ? 'Owner' : 'Other',
    },
    body: input.body,
    createdAt: '2026-08-16T10:00:00.000Z',
  }),
  findById: async () => rawComment(authorAccountId),
  delete: async () => true,
});

const dependencies = (
  documentComments = commentRepository(),
): DocumentCommentDeps => ({
  documentComments,
  documents: documentRepository(),
  ids: { nextId: () => COMMENT_ID },
});

describe('document comment use-cases', () => {
  it('authorizes before every repository access', async () => {
    const deps = dependencies();
    const documentRead = vi.spyOn(deps.documents, 'findAnyById');
    const documentWrite = vi.spyOn(deps.documents, 'findById');
    const list = vi.spyOn(deps.documentComments, 'listByDocument');
    const create = vi.spyOn(deps.documentComments, 'create');
    const find = vi.spyOn(deps.documentComments, 'findById');
    const remove = vi.spyOn(deps.documentComments, 'delete');
    const denied = { identity: identity('visitor', null, null) };

    await expect(listDocumentComments(denied, DOCUMENT_ID, {}, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(
      addDocumentComment(denied, DOCUMENT_ID, { body: 'Komentarz' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      deleteDocumentComment(denied, DOCUMENT_ID, COMMENT_ID, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    expect(documentRead).not.toHaveBeenCalled();
    expect(documentWrite).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('validates, trims, and bounds comment bodies before repository writes', async () => {
    const deps = dependencies();
    const create = vi.spyOn(deps.documentComments, 'create');

    for (const body of ['', '   ', 'x'.repeat(2001)]) {
      await expect(
        addDocumentComment({ identity: identity() }, DOCUMENT_ID, { body }, deps),
      ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(create).not.toHaveBeenCalled();

    await expect(
      addDocumentComment(
        { identity: identity() },
        DOCUMENT_ID,
        { body: '  Pierwsza linia\nDruga linia  ' },
        deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { body: 'Pierwsza linia\nDruga linia' },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        documentId: DOCUMENT_ID,
        authorAccountId: 'user-owner',
        body: 'Pierwsza linia\nDruga linia',
      }),
    );
  });

  it('forbids deleting another author comment and deletes an own comment', async () => {
    const foreignDeps = dependencies(commentRepository('user-other'));
    const foreignDelete = vi.spyOn(foreignDeps.documentComments, 'delete');

    await expect(
      deleteDocumentComment(
        { identity: identity() },
        DOCUMENT_ID,
        COMMENT_ID,
        foreignDeps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(foreignDelete).not.toHaveBeenCalled();

    const ownDeps = dependencies();
    const ownDelete = vi.spyOn(ownDeps.documentComments, 'delete');
    await expect(
      deleteDocumentComment(
        { identity: identity() },
        DOCUMENT_ID,
        COMMENT_ID,
        ownDeps,
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(ownDelete).toHaveBeenCalledOnce();
  });

  it('lists tenant-scoped comments with live author attribution', async () => {
    const deps = dependencies();
    const result = await listDocumentComments(
      { identity: identity() },
      DOCUMENT_ID,
      { limit: 50 },
      deps,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [{ author: { accountId: 'user-owner', name: 'Owner' } }],
        nextCursor: null,
      },
    });
  });

  it('rejects invalid identifiers, pagination, and cursors', async () => {
    const deps = dependencies();

    await expect(
      addDocumentComment({ identity: identity() }, 'invalid', { body: 'Komentarz' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      deleteDocumentComment({ identity: identity() }, DOCUMENT_ID, 'invalid', deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listDocumentComments({ identity: identity() }, 'invalid', {}, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listDocumentComments({ identity: identity() }, DOCUMENT_ID, { limit: 0 }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listDocumentComments({ identity: identity() }, DOCUMENT_ID, { cursor: 'invalid' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('returns not found results without leaking document or comment existence', async () => {
    const missingDocuments = {
      ...documentRepository(),
      findById: async () => null,
      findAnyById: async () => null,
    };
    const deps = { ...dependencies(), documents: missingDocuments };

    await expect(
      addDocumentComment({ identity: identity() }, DOCUMENT_ID, { body: 'Komentarz' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(
      deleteDocumentComment({ identity: identity() }, DOCUMENT_ID, COMMENT_ID, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(
      listDocumentComments({ identity: identity() }, DOCUMENT_ID, {}, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });

    const missingCommentDeps = dependencies({
      ...commentRepository(),
      findById: async () => null,
    });
    await expect(
      deleteDocumentComment(
        { identity: identity() },
        DOCUMENT_ID,
        COMMENT_ID,
        missingCommentDeps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('enforces API token write boundaries and reports a concurrent delete miss', async () => {
    const draftToken = {
      ...identity(),
      apiToken: { id: 'token-1', scopes: ['write:draft'] as const },
    };
    const writeToken = {
      ...identity(),
      apiToken: { id: 'token-2', scopes: ['write'] as const },
    };
    const deps = dependencies();

    await expect(
      addDocumentComment({ identity: draftToken }, DOCUMENT_ID, { body: 'Komentarz' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      addDocumentComment({ identity: writeToken }, DOCUMENT_ID, { body: 'Komentarz' }, deps),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      deleteDocumentComment({ identity: writeToken }, DOCUMENT_ID, COMMENT_ID, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const missedDeleteDeps = dependencies({
      ...commentRepository(),
      delete: async () => false,
    });
    await expect(
      deleteDocumentComment(
        { identity: identity() },
        DOCUMENT_ID,
        COMMENT_ID,
        missedDeleteDeps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('returns an opaque cursor only when another comment page exists', async () => {
    const first = listItem();
    const second = {
      ...listItem('user-other'),
      id: NEXT_COMMENT_ID,
      createdAt: '2026-08-16T11:00:00.000Z',
    };
    const deps = dependencies({
      ...commentRepository(),
      listByDocument: async () => [first, second],
    });

    await expect(
      listDocumentComments({ identity: identity() }, DOCUMENT_ID, { limit: 1 }, deps),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [first],
        nextCursor: expect.any(String),
      },
    });
  });
});
