import { describe, expect, it, vi } from 'vitest';

import {
  ok,
  type ApiTokenScope,
  type Document,
  type DocumentFile,
  type Identity,
  type SignatureRecord,
  type SourceUpdateRequest,
} from '#core/domain/index.js';

import type {
  DocumentRepository,
  SignatureRecordRepository,
  SourceUpdateRequestRepository,
  StoragePort,
} from '../ports.js';
import {
  cancelSourceUpdateRequest,
  completeSourceUpdateRequest,
  createSourceUpdateRequest,
  decideSourceUpdateRequest,
  getActiveSourceUpdateRequest,
  listPendingSourceUpdateRequests,
  type SourceUpdateRequestDeps,
} from './source-update-requests.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const sourceFileId = '22222222-2222-4222-8222-222222222222';
const oldSignedFileId = '33333333-3333-4333-8333-333333333333';
const stagedSourceFileId = '44444444-4444-4444-8444-444444444444';
const stagedSignedFileId = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const approvalId = '77777777-7777-4777-8777-777777777777';
const secondApprovalId = '88888888-8888-4888-8888-888888888888';
const recordId = '99999999-9999-4999-8999-999999999999';

const identity = (
  userId = 'user-requester',
  scopes: readonly ApiTokenScope[] | null = null,
): Identity => ({
  userId,
  email: `${userId}@example.com`,
  name: userId,
  tenantId: 'tenant-1',
  tenantSlug: 'default',
  tenantName: 'Default',
  staffRole: 'owner',
  apiToken: scopes ? { id: 'token-1', scopes } : null,
});

const document: Document = {
  id: documentId,
  tenantId: 'tenant-1',
  title: 'Umowa',
  docType: 'umowa-uod',
  documentDate: '2026-08-08',
  periodStart: null,
  periodEnd: null,
  person: null,
  tags: [],
  draft: false,
  signatureNotRequired: false,
  createdAt: '2026-08-08T10:00:00.000Z',
  updatedAt: '2026-08-08T10:00:00.000Z',
  deletedAt: null,
};

const file = (
  id: string,
  role: DocumentFile['role'],
  contentType = 'application/pdf',
): DocumentFile => ({
  id,
  documentId,
  role,
  fileName: `${id}.pdf`,
  contentType,
  sizeBytes: 10,
  storageKey: `documents/tenant-1/${documentId}/${id}`,
  createdAt: '2026-08-08T10:00:00.000Z',
});

const signatureStamp = (
  contributedBy?: string,
): SignatureRecord['payload'][number] => ({
  strokes: [{ points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] }],
  pageIndex: 0,
  placement: { offsetX: 0, offsetY: 0, scale: 1 },
  inkColor: 'black',
  inkSize: 2,
  ...(contributedBy === undefined ? {} : { contributedBy }),
});

const payload: SignatureRecord['payload'] = [signatureStamp()];

const record = (
  signedBy = 'user-requester',
  recordPayload: SignatureRecord['payload'] = payload,
): SignatureRecord => ({
  id: recordId,
  tenantId: 'tenant-1',
  documentId,
  fileId: oldSignedFileId,
  signedBy,
  payload: recordPayload,
  createdAt: '2026-08-08T10:00:00.000Z',
});

const documentRepository = (files: DocumentFile[]): DocumentRepository => ({
  listByTenant: async () => [{
    ...document,
    pendingDrafts: { comments: 0, links: 0, metadataProposals: 0 },
    signers: [],
  }],
  listDeletedByTenant: async () => [],
  findById: async (tenantId, id) =>
    tenantId === document.tenantId && id === document.id ? document : null,
  findDeletedById: async () => null,
  findAnyById: async () => document,
  getPendingDraftCounts: async () => ({ comments: 0, links: 0, metadataProposals: 0 }),
  listFiles: async () => files,
  listFilesIncludingDeleted: async () => files,
  listAllFilesIncludingDeleted: async () => files,
  listFilesForDocuments: async () => files,
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
  updateFileSize: async () => true,
  findFile: async (tenantId, id, candidateFileId) =>
    tenantId === document.tenantId && id === document.id
      ? files.find((candidate) => candidate.id === candidateFileId) ?? null
      : null,
  moveFileToDocument: async () => null,
  deleteFile: async () => true,
});

const signatureRepository = (
  records: SignatureRecord[],
): SignatureRecordRepository => ({
  listByDocument: async () => records,
  create: async () => null,
  recordSeal: async () => {},
});

const requestRepository = () => {
  const requests: SourceUpdateRequest[] = [];
  const repository: SourceUpdateRequestRepository = {
    create: async (input) => {
      if (
        requests.some(
          (request) =>
            request.documentId === input.documentId && request.status === 'pending',
        )
      ) {
        return null;
      }
      const created: SourceUpdateRequest = {
        id: input.id,
        tenantId: input.tenantId,
        documentId: input.documentId,
        requestedBy: input.requestedBy,
        newSourceFileId: input.newSourceFileId,
        mode: input.mode,
        status: 'pending',
        approvals: input.approvalIds.map((approval) => ({
          ...approval,
          decision: 'pending',
        })),
      };
      requests.push(created);
      return created;
    },
    findById: async (tenantId, id) =>
      requests.find((request) => request.tenantId === tenantId && request.id === id) ?? null,
    findActiveByDocument: async (tenantId, id) =>
      requests.find(
        (request) =>
          request.tenantId === tenantId &&
          request.documentId === id &&
          request.status === 'pending',
      ) ?? null,
    listPendingByApprover: async (tenantId, approverId) =>
      requests.filter(
        (request) =>
          request.tenantId === tenantId &&
          request.status === 'pending' &&
          request.approvals.some(
            (approval) =>
              approval.approverId === approverId && approval.decision === 'pending',
          ),
      ),
    decide: async (tenantId, id, approverId, decision) => {
      const index = requests.findIndex(
        (request) =>
          request.tenantId === tenantId && request.id === id && request.status === 'pending',
      );
      const current = requests[index];
      if (!current) return null;
      const approvals = current.approvals.map((approval) =>
        approval.approverId === approverId && approval.decision === 'pending'
          ? { ...approval, decision }
          : approval,
      );
      const updated: SourceUpdateRequest = {
        ...current,
        approvals,
        status: decision === 'rejected' ? 'rejected' : 'pending',
      };
      requests[index] = updated;
      return updated;
    },
    cancel: async (tenantId, id, requestedBy) => {
      const index = requests.findIndex(
        (request) =>
          request.tenantId === tenantId &&
          request.id === id &&
          request.requestedBy === requestedBy &&
          request.status === 'pending',
      );
      const current = requests[index];
      if (!current) return null;
      const updated: SourceUpdateRequest = { ...current, status: 'cancelled' };
      requests[index] = updated;
      return updated;
    },
    complete: async (input) => {
      const index = requests.findIndex(
        (request) =>
          request.tenantId === input.tenantId &&
          request.id === input.requestId &&
          request.status === 'pending',
      );
      const current = requests[index];
      if (!current) return null;
      const updated: SourceUpdateRequest = { ...current, status: 'completed' };
      requests[index] = updated;
      return updated;
    },
  };
  return { repository, requests };
};

const dependencies = ({
  files = [
    file(sourceFileId, 'source'),
    file(oldSignedFileId, 'signed-digital'),
    file(stagedSourceFileId, 'other'),
    file(stagedSignedFileId, 'other'),
  ],
  records = [record()],
}: {
  files?: DocumentFile[];
  records?: SignatureRecord[];
} = {}) => {
  const sourceUpdates = requestRepository();
  const deletedKeys: string[] = [];
  const storage: StoragePort = {
    put: async () => ok(undefined),
    get: async () => ok(null),
    head: async () => ok(null),
    delete: async (key) => {
      deletedKeys.push(key);
      return ok(undefined);
    },
    createUploadUrl: async () => ok(null),
  };
  const ids = [requestId, approvalId, secondApprovalId];
  return {
    deps: {
      documents: documentRepository(files),
      signatureRecords: signatureRepository(records),
      sourceUpdateRequests: sourceUpdates.repository,
      storage,
      ids: { nextId: () => ids.shift() ?? secondApprovalId },
    } satisfies SourceUpdateRequestDeps,
    deletedKeys,
    requests: sourceUpdates.requests,
  };
};

describe('source update request use-cases', () => {
  it('creates an immediate transfer when every signature belongs to the requester', async () => {
    const { deps } = dependencies();
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        documentId,
        { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
        deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: requestId, approvals: [] },
    });
  });

  it('requires each distinct other signer once and lists their pending notification', async () => {
    const { deps } = dependencies({
      records: [record('user-signer'), { ...record('user-signer'), id: approvalId }],
    });
    const created = await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      deps,
    );
    expect(created).toMatchObject({
      ok: true,
      value: { approvals: [{ approverId: 'user-signer', decision: 'pending' }] },
    });
    await expect(
      listPendingSourceUpdateRequests({ identity: identity('user-signer') }, deps),
    ).resolves.toMatchObject({ ok: true, value: [{ id: requestId }] });
    await expect(
      getActiveSourceUpdateRequest({ identity: identity() }, documentId, deps),
    ).resolves.toMatchObject({ ok: true, value: { id: requestId } });
  });

  it.each([
    {
      name: 'uses signed_by for a legacy record owned by another account',
      records: [record('user-desktop')],
      approvals: ['user-desktop'],
    },
    {
      name: 'does not require the desktop account when every stamp belongs to the requester',
      records: [
        record('user-desktop', [
          signatureStamp('user-requester'),
          signatureStamp('user-requester'),
        ]),
      ],
      approvals: [],
    },
    {
      name: 'requires the pad contributor when the requester flattened the session',
      records: [record('user-requester', [signatureStamp('user-pad')])],
      approvals: ['user-pad'],
    },
    {
      name: 'uses signed_by only for stamps without contributor precision',
      records: [
        record('user-desktop', [
          signatureStamp('user-requester'),
          signatureStamp(),
        ]),
      ],
      approvals: ['user-desktop'],
    },
    {
      name: 'unions and deduplicates contributors across records',
      records: [
        record('user-desktop', [
          signatureStamp('user-requester'),
          signatureStamp('user-pad-a'),
          signatureStamp('user-pad-b'),
        ]),
        { ...record('user-other-desktop', [signatureStamp('user-pad-a')]), id: approvalId },
      ],
      approvals: ['user-pad-a', 'user-pad-b'],
    },
  ])('$name', async ({ records, approvals }) => {
    const { deps } = dependencies({ records });
    const created = await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      deps,
    );
    expect(created).toMatchObject({
      ok: true,
      value: {
        approvals: approvals.map((approverId) => ({ approverId, decision: 'pending' })),
      },
    });
  });

  it('enforces the single-active constraint and validates staged files and legacy signatures', async () => {
    const { deps } = dependencies();
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'delete-signed' },
      deps,
    );
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        documentId,
        { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
        deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });

    const legacy = dependencies({ records: [] });
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        documentId,
        { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
        legacy.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });

    const image = dependencies({
      files: [file(stagedSourceFileId, 'other', 'image/png')],
    });
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        documentId,
        { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
        image.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });

    const notStaged = dependencies({ files: [file(stagedSourceFileId, 'source')] });
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        documentId,
        { newSourceFileId: stagedSourceFileId, mode: 'delete-signed' },
        notStaged.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('records acceptance, rejects cross-user decisions, and rejects the whole request', async () => {
    const { deps } = dependencies({ records: [record('user-signer')] });
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      deps,
    );
    await expect(
      decideSourceUpdateRequest(
        { identity: identity('user-other') },
        requestId,
        { decision: 'accept' },
        deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      decideSourceUpdateRequest(
        { identity: identity('user-signer') },
        requestId,
        { decision: 'accept' },
        deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'pending', approvals: [{ decision: 'accepted' }] },
    });
    await expect(
      decideSourceUpdateRequest(
        { identity: identity('user-signer') },
        requestId,
        { decision: 'accept' },
        deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });

    const rejected = dependencies({ records: [record('user-signer')] });
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      rejected.deps,
    );
    await expect(
      decideSourceUpdateRequest(
        { identity: identity('user-signer') },
        requestId,
        { decision: 'reject' },
        rejected.deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'rejected' } });
  });

  it('allows only the requester to cancel a pending request', async () => {
    const { deps } = dependencies({ records: [record('user-signer')] });
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      deps,
    );
    await expect(
      cancelSourceUpdateRequest({ identity: identity('user-signer') }, requestId, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      cancelSourceUpdateRequest({ identity: identity() }, requestId, deps),
    ).resolves.toMatchObject({ ok: true, value: { status: 'cancelled' } });
    await expect(
      cancelSourceUpdateRequest({ identity: identity() }, requestId, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('completes delete and transfer modes only after approvals and removes prior blobs', async () => {
    const deletion = dependencies();
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'delete-signed' },
      deletion.deps,
    );
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        {},
        deletion.deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(deletion.deletedKeys).toEqual([
      file(sourceFileId, 'source').storageKey,
      file(oldSignedFileId, 'signed-digital').storageKey,
    ]);

    const transfer = dependencies({ records: [record('user-signer')] });
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      transfer.deps,
    );
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        { signedFileId: stagedSignedFileId },
        transfer.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
    await decideSourceUpdateRequest(
      { identity: identity('user-signer') },
      requestId,
      { decision: 'accept' },
      transfer.deps,
    );
    await expect(
      completeSourceUpdateRequest(
        { identity: identity('user-signer') },
        requestId,
        { signedFileId: stagedSignedFileId },
        transfer.deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'completed' } });
  });


  it('validates identifiers and missing document resources before repository writes', async () => {
    const invalid = dependencies();
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        'not-a-document-id',
        { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
        invalid.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      getActiveSourceUpdateRequest(
        { identity: identity() },
        'not-a-document-id',
        invalid.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    for (const result of [
      decideSourceUpdateRequest(
        { identity: identity() },
        'not-a-request-id',
        { decision: 'accept' },
        invalid.deps,
      ),
      cancelSourceUpdateRequest(
        { identity: identity() },
        'not-a-request-id',
        invalid.deps,
      ),
      completeSourceUpdateRequest(
        { identity: identity() },
        'not-a-request-id',
        {},
        invalid.deps,
      ),
    ]) {
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: { code: 'validation' },
      });
    }

    const missingDocument = dependencies();
    missingDocument.deps.documents.findById = async () => null;
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        documentId,
        { newSourceFileId: stagedSourceFileId, mode: 'delete-signed' },
        missingDocument.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });

    const missingFile = dependencies({ files: [] });
    await expect(
      createSourceUpdateRequest(
        { identity: identity() },
        documentId,
        { newSourceFileId: stagedSourceFileId, mode: 'delete-signed' },
        missingFile.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('guards completion actors, modes, staged files, and terminal requests', async () => {
    const transfer = dependencies();
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      transfer.deps,
    );
    await expect(
      completeSourceUpdateRequest(
        { identity: identity('user-other') },
        requestId,
        { signedFileId: stagedSignedFileId },
        transfer.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        {},
        transfer.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        { signedFileId: stagedSourceFileId },
        transfer.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });

    const invalidSignedFile = dependencies({
      files: [
        file(sourceFileId, 'source'),
        file(oldSignedFileId, 'signed-digital'),
        file(stagedSourceFileId, 'other'),
        file(stagedSignedFileId, 'source'),
      ],
    });
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      invalidSignedFile.deps,
    );
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        { signedFileId: stagedSignedFileId },
        invalidSignedFile.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });

    const deletion = dependencies();
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'delete-signed' },
      deletion.deps,
    );
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        { signedFileId: stagedSignedFileId },
        deletion.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await cancelSourceUpdateRequest(
      { identity: identity() },
      requestId,
      deletion.deps,
    );
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        {},
        deletion.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });

    const repositoryConflict = dependencies();
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'delete-signed' },
      repositoryConflict.deps,
    );
    repositoryConflict.deps.sourceUpdateRequests.complete = async () => null;
    await expect(
      completeSourceUpdateRequest(
        { identity: identity() },
        requestId,
        {},
        repositoryConflict.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
  it('never allows API tokens to create, decide, cancel, or complete requests', async () => {
    for (const scopes of [['read'], ['write'], ['write:draft']] as const) {
      const { deps } = dependencies({ records: [record('user-signer')] });
      const create = vi.spyOn(deps.sourceUpdateRequests, 'create');
      const find = vi.spyOn(deps.sourceUpdateRequests, 'findById');
      const ctx = { identity: identity('user-signer', scopes) };
      await expect(
        createSourceUpdateRequest(
          ctx,
          documentId,
          { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
          deps,
        ),
      ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
      await expect(
        decideSourceUpdateRequest(ctx, requestId, { decision: 'accept' }, deps),
      ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
      await expect(
        cancelSourceUpdateRequest(ctx, requestId, deps),
      ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
      await expect(
        completeSourceUpdateRequest(ctx, requestId, {}, deps),
      ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(create).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
    }
  });

  it('allows read tokens to inspect active and pending requests but denies write-only tokens', async () => {
    const { deps } = dependencies({ records: [record('user-signer')] });
    await createSourceUpdateRequest(
      { identity: identity() },
      documentId,
      { newSourceFileId: stagedSourceFileId, mode: 'transfer' },
      deps,
    );
    await expect(
      getActiveSourceUpdateRequest(
        { identity: identity('user-signer', ['read']) },
        documentId,
        deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: { id: requestId } });
    await expect(
      listPendingSourceUpdateRequests(
        { identity: identity('user-signer', ['read']) },
        deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: [{ id: requestId }] });
    await expect(
      getActiveSourceUpdateRequest(
        { identity: identity('user-signer', ['write']) },
        documentId,
        deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
