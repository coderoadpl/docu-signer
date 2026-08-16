import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DOCUMENT_TYPES,
  type Document,
  type DocumentMetadataProposal,
  type Identity,
} from '#core/domain/index.js';

import type {
  DocumentMetadataProposalRepository,
  DocumentRepository,
} from '../ports.js';
import {
  approveDocumentMetadataProposal,
  listDocumentMetadataProposals,
  rejectDocumentMetadataProposal,
  type DocumentMetadataProposalDeps,
} from './document-metadata-proposals.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';

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

const documentRow = (): Document => ({
  id: DOCUMENT_ID,
  tenantId: 'tenant-default',
  title: 'Current title',
  docType: 'umowa-uod',
  documentDate: '2026-08-01',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  person: 'Current person',
  tags: ['current'],
  draft: false,
  signatureNotRequired: false,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  deletedAt: null,
});

const proposalRow = (
  changes: DocumentMetadataProposal['changes'] = {
    person: 'Proposed person',
    tags: ['proposed'],
  },
): DocumentMetadataProposal => ({
  id: PROPOSAL_ID,
  tenantId: 'tenant-default',
  documentId: DOCUMENT_ID,
  changes,
  creatorAccountId: 'user-importer',
  createdAt: '2026-08-16T10:00:00.000Z',
});

const documentRepository = (current: Document): DocumentRepository => ({
  listByTenant: async () => [],
  listDeletedByTenant: async () => [],
  findById: async (tenantId, documentId) =>
    tenantId === current.tenantId && documentId === current.id ? current : null,
  findDeletedById: async () => null,
  findAnyById: async (tenantId, documentId) =>
    tenantId === current.tenantId && documentId === current.id ? current : null,
  getPendingDraftCounts: async () => ({ comments: 0, links: 0, metadataProposals: 1 }),
  listFiles: async () => [],
  listFilesIncludingDeleted: async () => [],
  listAllFilesIncludingDeleted: async () => [],
  listFilesForDocuments: async () => [],
  create: async () => current,
  update: async () => current,
  approve: async () => current,
  unapprove: async () => current,
  waiveSignature: async () => current,
  requireSignature: async () => current,
  delete: async () => false,
  restore: async () => current,
  purge: async () => false,
  createFile: async () => null,
  updateFileSize: async () => false,
  findFile: async () => null,
  moveFileToDocument: async () => null,
  deleteFile: async () => false,
});

const state = (
  proposal: DocumentMetadataProposal | null = proposalRow(),
): { deps: DocumentMetadataProposalDeps; proposals: DocumentMetadataProposal[] } => {
  const current = documentRow();
  const proposals = proposal ? [proposal] : [];
  const repository: DocumentMetadataProposalRepository = {
    listByDocument: async (tenantId, documentId) =>
      proposals
        .filter((item) => item.tenantId === tenantId && item.documentId === documentId)
        .map((item) => ({
          id: item.id,
          tenantId: item.tenantId,
          documentId: item.documentId,
          changes: item.changes,
          creator: { accountId: item.creatorAccountId, name: 'Importer' },
          createdAt: item.createdAt,
        })),
    create: async () => { throw new Error('not implemented'); },
    findById: async (tenantId, proposalId) =>
      proposals.find((item) => item.tenantId === tenantId && item.id === proposalId) ?? null,
    apply: async (tenantId, proposalId, changes) => {
      const index = proposals.findIndex(
        (item) => item.tenantId === tenantId && item.id === proposalId,
      );
      if (index < 0) return null;
      proposals.splice(index, 1);
      return {
        ...current,
        title: changes.title ?? current.title,
        docType: changes.docType ?? current.docType,
        documentDate: changes.documentDate ?? current.documentDate,
        periodStart:
          changes.periodStart === undefined ? current.periodStart : changes.periodStart,
        periodEnd: changes.periodEnd === undefined ? current.periodEnd : changes.periodEnd,
        person: changes.person === undefined ? current.person : changes.person,
        tags: changes.tags ?? current.tags,
        updatedAt: '2026-08-16T11:00:00.000Z',
      };
    },
    reject: async (tenantId, proposalId) => {
      const index = proposals.findIndex(
        (item) => item.tenantId === tenantId && item.id === proposalId,
      );
      if (index < 0) return false;
      proposals.splice(index, 1);
      return true;
    },
  };
  return {
    deps: {
      documentMetadataProposals: repository,
      documents: documentRepository(current),
      documentTypes: {
        listByTenant: async () => [...DEFAULT_DOCUMENT_TYPES],
        findBySlug: async (_tenantId, slug) =>
          DEFAULT_DOCUMENT_TYPES.find((type) => type.slug === slug) ?? null,
        create: async () => null,
        rename: async () => null,
        delete: async () => false,
        isUsedByAnyDocument: async () => false,
      },
    },
    proposals,
  };
};

const ctx = (value: Identity) => ({ identity: value });

describe('document metadata proposal use-cases', () => {
  it('lists proposals with cursor pagination and validates list requests', async () => {
    const currentState = state();
    const first = await currentState.deps.documentMetadataProposals.listByDocument(
      'tenant-default',
      DOCUMENT_ID,
      null,
      10,
    );
    const item = first[0];
    if (!item) throw new Error('Missing proposal fixture');
    const list = vi
      .spyOn(currentState.deps.documentMetadataProposals, 'listByDocument')
      .mockResolvedValue([
        item,
        {
          ...item,
          id: '33333333-3333-4333-8333-333333333333',
          createdAt: '2026-08-16T11:00:00.000Z',
        },
      ]);

    const page = await listDocumentMetadataProposals(
      ctx(identity('tenant-default')),
      DOCUMENT_ID,
      { limit: 1 },
      currentState.deps,
    );
    expect(page).toMatchObject({
      ok: true,
      value: { items: [{ id: PROPOSAL_ID }], nextCursor: expect.any(String) },
    });
    if (!page.ok || page.value.nextCursor === null) throw new Error('Missing next cursor');
    await listDocumentMetadataProposals(
      ctx(identity('tenant-default')),
      DOCUMENT_ID,
      { cursor: page.value.nextCursor, limit: 1 },
      currentState.deps,
    );
    expect(list).toHaveBeenLastCalledWith(
      'tenant-default',
      DOCUMENT_ID,
      { createdAt: item.createdAt, id: item.id },
      2,
    );

    await expect(
      listDocumentMetadataProposals(
        ctx(identity('tenant-default')),
        'invalid',
        {},
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listDocumentMetadataProposals(
        ctx(identity('tenant-default')),
        DOCUMENT_ID,
        { limit: 0 },
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listDocumentMetadataProposals(
        ctx(identity('tenant-default')),
        DOCUMENT_ID,
        { cursor: 'invalid' },
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listDocumentMetadataProposals(
        ctx(identity('tenant-default')),
        '44444444-4444-4444-8444-444444444444',
        {},
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('applies proposed fields to the current document and removes the proposal', async () => {
    const currentState = state();
    const findDocument = vi.spyOn(currentState.deps.documents, 'findById');

    await expect(
      approveDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        currentState.deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        title: 'Current title',
        person: 'Proposed person',
        tags: ['proposed'],
      },
    });
    expect(findDocument).toHaveBeenCalledWith('tenant-default', DOCUMENT_ID);
    expect(currentState.proposals).toEqual([]);
  });

  it('validates the proposed document type against the current tenant dictionary', async () => {
    const currentState = state(proposalRow({ docType: 'removed-type' }));
    const apply = vi.spyOn(currentState.deps.documentMetadataProposals, 'apply');

    await expect(
      approveDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(apply).not.toHaveBeenCalled();
    expect(currentState.proposals).toHaveLength(1);
  });

  it('validates identifiers, current state, and concurrent resolution before applying', async () => {
    const currentState = state(proposalRow({ periodStart: '2026-09-01' }));
    const apply = vi.spyOn(currentState.deps.documentMetadataProposals, 'apply');

    await expect(
      approveDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        'invalid',
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      rejectDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        'invalid',
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      approveDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(apply).not.toHaveBeenCalled();

    const missingDocument = state();
    missingDocument.deps.documents.findById = async () => null;
    await expect(
      approveDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        missingDocument.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });

    const resolvedDuringApply = state();
    resolvedDuringApply.deps.documentMetadataProposals.apply = async () => null;
    await expect(
      approveDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        resolvedDuringApply.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects by removing the proposal and reports already-resolved proposals as not found', async () => {
    const currentState = state();

    await expect(
      rejectDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        currentState.deps,
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      rejectDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(
      approveDocumentMetadataProposal(
        ctx(identity('tenant-default')),
        PROPOSAL_ID,
        currentState.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('authorizes every operation before repository access', async () => {
    const currentState = state();
    const list = vi.spyOn(currentState.deps.documentMetadataProposals, 'listByDocument');
    const find = vi.spyOn(currentState.deps.documentMetadataProposals, 'findById');
    const reject = vi.spyOn(currentState.deps.documentMetadataProposals, 'reject');
    const denied = ctx(identity(null));

    await expect(
      listDocumentMetadataProposals(denied, DOCUMENT_ID, {}, currentState.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      approveDocumentMetadataProposal(denied, PROPOSAL_ID, currentState.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      rejectDocumentMetadataProposal(denied, PROPOSAL_ID, currentState.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(list).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });
});
