import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DOCUMENT_TYPES,
  type Document,
  type DocumentComment,
  type DocumentLink,
  type DocumentMetadataProposal,
  type Identity,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { DocumentRepository } from '../ports.js';
import {
  bulkApprovePendingDrafts,
  type BulkApprovePendingDraftsDeps,
} from './document-pending-drafts.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const COMMENT_ID = '66666666-6666-4666-8666-666666666666';
const LINK_ID = '77777777-7777-4777-8777-777777777777';

const identity = (tenantId: string | null): Identity => ({
  userId: 'user-owner',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId,
  tenantSlug: tenantId ? 'default' : null,
  tenantName: tenantId ? 'Archive' : null,
  staffRole: tenantId ? 'owner' : null,
  apiToken: null,
});

const ctx = (value: Identity): Ctx => ({ identity: value });

const documentRow = (id: string): Document => ({
  id,
  tenantId: 'tenant-default',
  title: 'Current title',
  docType: 'umowa-uod',
  documentDate: '2026-08-01',
  periodStart: null,
  periodEnd: null,
  person: 'Current person',
  tags: ['current'],
  draft: false,
  signatureNotRequired: false,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  deletedAt: null,
});

const proposalRow = (
  overrides: Partial<DocumentMetadataProposal> = {},
): DocumentMetadataProposal => ({
  id: '22222222-2222-4222-8222-222222222222',
  tenantId: 'tenant-default',
  documentId: DOCUMENT_ID,
  changes: { person: 'Proposed person' },
  creatorAccountId: 'user-importer',
  createdAt: '2026-08-16T10:00:00.000Z',
  ...overrides,
});

const commentRow = (overrides: Partial<DocumentComment> = {}): DocumentComment => ({
  id: COMMENT_ID,
  tenantId: 'tenant-default',
  documentId: DOCUMENT_ID,
  authorAccountId: 'user-importer',
  body: 'Do sprawdzenia',
  draft: true,
  createdAt: '2026-08-16T10:00:00.000Z',
  ...overrides,
});

const linkRow = (overrides: Partial<DocumentLink> = {}): DocumentLink => ({
  id: LINK_ID,
  tenantId: 'tenant-default',
  fromDocumentId: DOCUMENT_ID,
  toDocumentId: OTHER_DOCUMENT_ID,
  label: null,
  draft: true,
  ...overrides,
});

interface Fixture {
  deps: BulkApprovePendingDraftsDeps;
  documents: Document[];
  proposals: DocumentMetadataProposal[];
  comments: DocumentComment[];
  links: DocumentLink[];
}

const fixture = (input?: {
  proposals?: DocumentMetadataProposal[];
  comments?: DocumentComment[];
  links?: DocumentLink[];
}): Fixture => {
  const documents = [documentRow(DOCUMENT_ID), documentRow(OTHER_DOCUMENT_ID)];
  const proposals = [...(input?.proposals ?? [])];
  const comments = [...(input?.comments ?? [])];
  const links = [...(input?.links ?? [])];
  const findDocument = (tenantId: string, documentId: string) =>
    documents.find(
      (document) => document.tenantId === tenantId && document.id === documentId,
    ) ?? null;
  const documentRepository: DocumentRepository = {
    listByTenant: async () => [],
    listDeletedByTenant: async () => [],
    findById: async (tenantId, documentId) => findDocument(tenantId, documentId),
    findDeletedById: async () => null,
    findAnyById: async (tenantId, documentId) => findDocument(tenantId, documentId),
    getPendingDraftCounts: async () => ({ comments: 0, links: 0, metadataProposals: 0 }),
    listFiles: async () => [],
    listFilesIncludingDeleted: async () => [],
    listAllFilesIncludingDeleted: async () => [],
    listFilesForDocuments: async () => [],
    create: async () => documentRow(DOCUMENT_ID),
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
  };
  return {
    documents,
    proposals,
    comments,
    links,
    deps: {
      documents: documentRepository,
      documentTypes: {
        listByTenant: async () => [...DEFAULT_DOCUMENT_TYPES],
        findBySlug: async (_tenantId, slug) =>
          DEFAULT_DOCUMENT_TYPES.find((type) => type.slug === slug) ?? null,
        create: async () => null,
        rename: async () => null,
        setHidden: async () => null,
        delete: async () => false,
        isUsedByAnyDocument: async () => false,
      },
      documentMetadataProposals: {
        listPendingByDocuments: async (tenantId, documentIds) =>
          proposals
            .filter(
              (proposal) =>
                proposal.tenantId === tenantId && documentIds.includes(proposal.documentId),
            )
            .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
        listByDocument: async () => [],
        create: async () => {
          throw new Error('not implemented');
        },
        findById: async () => null,
        apply: async (tenantId, proposalId, changes) => {
          const index = proposals.findIndex(
            (proposal) => proposal.tenantId === tenantId && proposal.id === proposalId,
          );
          if (index < 0) return null;
          const [applied] = proposals.splice(index, 1);
          if (!applied) return null;
          const documentIndex = documents.findIndex(
            (document) => document.id === applied.documentId,
          );
          const document = documents[documentIndex];
          if (!document) return null;
          const updated = {
            ...document,
            person: changes.person === undefined ? document.person : changes.person,
            title: changes.title ?? document.title,
          };
          documents[documentIndex] = updated;
          return updated;
        },
        reject: async () => false,
      },
      documentComments: {
        listPendingByDocuments: async (tenantId, documentIds) =>
          comments.filter(
            (comment) =>
              comment.tenantId === tenantId &&
              comment.draft &&
              documentIds.includes(comment.documentId),
          ),
        listByDocument: async () => [],
        create: async () => {
          throw new Error('not implemented');
        },
        approve: async (tenantId, commentId) => {
          const index = comments.findIndex(
            (comment) => comment.tenantId === tenantId && comment.id === commentId,
          );
          const comment = comments[index];
          if (!comment) return null;
          const approved = { ...comment, draft: false };
          comments[index] = approved;
          const { authorAccountId, ...rest } = approved;
          return { ...rest, author: { accountId: authorAccountId, name: 'Importer' } };
        },
        findById: async () => null,
        delete: async () => false,
      },
      documentLinks: {
        listPendingByDocuments: async (tenantId, documentIds) =>
          links.filter(
            (link) =>
              link.tenantId === tenantId &&
              link.draft &&
              (documentIds.includes(link.fromDocumentId) ||
                documentIds.includes(link.toDocumentId)),
          ),
        create: async () => null,
        findBetween: async () => null,
        listForDocument: async () => [],
        approve: async (tenantId, linkId) => {
          const index = links.findIndex(
            (link) => link.tenantId === tenantId && link.id === linkId,
          );
          const link = links[index];
          if (!link) return null;
          const approved = { ...link, draft: false };
          links[index] = approved;
          return approved;
        },
        deleteBetween: async () => false,
      },
    },
  };
};

describe('bulk pending draft approval', () => {
  it('approves proposals, draft comments and draft links of the selected documents', async () => {
    const current = fixture({
      proposals: [proposalRow()],
      comments: [commentRow()],
      links: [linkRow()],
    });

    await expect(
      bulkApprovePendingDrafts(
        ctx(identity('tenant-default')),
        { documentIds: [DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { approved: 1, skipped: 0, metadataProposals: 1, comments: 1, links: 1 },
    });
    expect(current.proposals).toEqual([]);
    expect(current.comments.map((comment) => comment.draft)).toEqual([false]);
    expect(current.links.map((link) => link.draft)).toEqual([false]);
    expect(current.documents[0]?.person).toBe('Proposed person');
  });

  it('applies proposals chronologically with field-wise newest-wins merging', async () => {
    const current = fixture({
      proposals: [
        proposalRow({
          id: '33333333-3333-4333-8333-333333333333',
          changes: { person: 'First person', title: 'First title' },
          createdAt: '2026-08-16T09:00:00.000Z',
        }),
        proposalRow({
          id: '44444444-4444-4444-8444-444444444444',
          changes: { person: 'Newest person' },
          createdAt: '2026-08-16T10:00:00.000Z',
        }),
      ],
    });
    const apply = vi.spyOn(current.deps.documentMetadataProposals, 'apply');

    await expect(
      bulkApprovePendingDrafts(
        ctx(identity('tenant-default')),
        { documentIds: [DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { approved: 1, skipped: 0, metadataProposals: 2, comments: 0, links: 0 },
    });
    expect(apply.mock.calls.map((call) => call[1])).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(current.documents[0]).toMatchObject({
      person: 'Newest person',
      title: 'First title',
    });
  });

  it('validates proposed document types before approving anything', async () => {
    const current = fixture({
      proposals: [proposalRow({ changes: { docType: 'removed-type' } })],
      comments: [commentRow()],
    });
    const approveComment = vi.spyOn(current.deps.documentComments, 'approve');

    await expect(
      bulkApprovePendingDrafts(
        ctx(identity('tenant-default')),
        { documentIds: [DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(approveComment).not.toHaveBeenCalled();
    expect(current.proposals).toHaveLength(1);
  });

  it('counts a link once and marks both of its selected documents as approved', async () => {
    const current = fixture({ links: [linkRow()] });

    await expect(
      bulkApprovePendingDrafts(
        ctx(identity('tenant-default')),
        { documentIds: [DOCUMENT_ID, OTHER_DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { approved: 2, skipped: 0, metadataProposals: 0, comments: 0, links: 1 },
    });
  });

  it('skips documents without pending drafts and is idempotent', async () => {
    const current = fixture({ comments: [commentRow()] });

    await expect(
      bulkApprovePendingDrafts(
        ctx(identity('tenant-default')),
        { documentIds: [DOCUMENT_ID, OTHER_DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { approved: 1, skipped: 1, metadataProposals: 0, comments: 1, links: 0 },
    });
    await expect(
      bulkApprovePendingDrafts(
        ctx(identity('tenant-default')),
        { documentIds: [DOCUMENT_ID, OTHER_DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { approved: 0, skipped: 2, metadataProposals: 0, comments: 0, links: 0 },
    });
  });

  it('rejects invalid input and authorizes before any repository access', async () => {
    const current = fixture({
      proposals: [proposalRow()],
      comments: [commentRow()],
      links: [linkRow()],
    });
    const listProposals = vi.spyOn(
      current.deps.documentMetadataProposals,
      'listPendingByDocuments',
    );
    const listComments = vi.spyOn(current.deps.documentComments, 'listPendingByDocuments');
    const listLinks = vi.spyOn(current.deps.documentLinks, 'listPendingByDocuments');

    await expect(
      bulkApprovePendingDrafts(
        ctx(identity(null)),
        { documentIds: [DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      bulkApprovePendingDrafts(
        ctx(identity('tenant-default')),
        { documentIds: [DOCUMENT_ID, DOCUMENT_ID] },
        current.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(listProposals).not.toHaveBeenCalled();
    expect(listComments).not.toHaveBeenCalled();
    expect(listLinks).not.toHaveBeenCalled();
  });

  it('refuses a draft-scoped API token that may write but not approve', async () => {
    const current = fixture({
      proposals: [proposalRow()],
      comments: [commentRow()],
      links: [linkRow()],
    });
    const draftToken: Identity = {
      ...identity('tenant-default'),
      apiToken: { id: 'token-draft', scopes: ['write:draft'] },
    };

    await expect(
      bulkApprovePendingDrafts(ctx(draftToken), { documentIds: [DOCUMENT_ID] }, current.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(current.proposals).toHaveLength(1);
    expect(current.comments.map((comment) => comment.draft)).toEqual([true]);
    expect(current.links.map((link) => link.draft)).toEqual([true]);
  });
});
