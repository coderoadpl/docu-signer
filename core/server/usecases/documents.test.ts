import { describe, expect, it, vi } from 'vitest';

import {
  err,
  internal,
  MAX_DOCUMENT_EXPORT_BYTES,
  MAX_DOCUMENT_FILE_BYTES,
  ok,
  type AppError,
  type Document,
  type DocumentFile,
  type Identity,
  type Result,
} from '#core/domain/index.js';

import type { DocumentRepository, StoragePort } from '../ports.js';
import {
  approveDocument,
  createDocument,
  deleteDocument,
  exportDocuments,
  finalizeFileUpload,
  getDocument,
  getFileContent,
  getFileExport,
  listDocuments,
  listTrashedDocuments,
  moveDocumentFile,
  purgeDocument,
  removeFile,
  requestFileUpload,
  restoreDocument,
  serverUpload,
  type DocumentDeps,
  updateDocument,
} from './documents.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const uploadId = '33333333-3333-4333-8333-333333333333';
const movedDocumentId = '44444444-4444-4444-8444-444444444444';

const staff = (tenantId: string | null, role: 'owner' | 'admin' = 'owner'): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme Inc' : null,
  staffRole: tenantId ? role : null,
  apiToken: null,
});

const member: Identity = {
  userId: 'u2',
  email: 'member@example.com',
  name: 'Member',
  tenantId: 'tenant-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: null,
  apiToken: null,
};

const documentRow = (tenantId = 'tenant-acme'): Document => ({
  id: documentId,
  tenantId,
  title: 'Agreement',
  docType: 'umowa-uod',
  documentDate: '2026-07-01',
  periodStart: null,
  periodEnd: null,
  person: null,
  tags: ['contract'],
  draft: false,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  deletedAt: null,
});

const fileRow = (): DocumentFile => ({
  id: fileId,
  documentId,
  role: 'source',
  fileName: 'agreement.pdf',
  contentType: 'application/pdf',
  sizeBytes: 3,
  storageKey: `documents/tenant-acme/${documentId}/${uploadId}`,
  createdAt: '2026-07-01T10:00:00.000Z',
});

const fake = (
  initialDocuments: Document[] = [],
  initialFiles: DocumentFile[] = [],
  idSequence: string[] = [documentId, uploadId, fileId],
) => {
  const documents = [...initialDocuments];
  const files = [...initialFiles];
  const blobs = new Map<string, Uint8Array>();
  for (const file of files) blobs.set(file.storageKey, new Uint8Array([1, 2, 3]));

  const repo: DocumentRepository = {
    listByTenant: async (tenantId) =>
      documents.filter((document) => document.tenantId === tenantId && document.deletedAt === null),
    listDeletedByTenant: async (tenantId) =>
      documents.filter((document) => document.tenantId === tenantId && document.deletedAt !== null),
    findById: async (tenantId, id) =>
      documents.find(
        (document) =>
          document.tenantId === tenantId && document.id === id && document.deletedAt === null,
      ) ?? null,
    findDeletedById: async (tenantId, id) =>
      documents.find(
        (document) =>
          document.tenantId === tenantId && document.id === id && document.deletedAt !== null,
      ) ?? null,
    findAnyById: async (tenantId, id) =>
      documents.find((document) => document.tenantId === tenantId && document.id === id) ?? null,
    listFiles: async (tenantId, id) =>
      files.filter(
        (file) =>
          file.documentId === id &&
          documents.some(
            (document) =>
              document.id === id && document.tenantId === tenantId && document.deletedAt === null,
          ),
      ),
    listFilesIncludingDeleted: async (tenantId, id) =>
      files.filter(
        (file) =>
          file.documentId === id &&
          documents.some(
            (document) => document.id === id && document.tenantId === tenantId,
          ),
      ),
    listAllFilesIncludingDeleted: async (tenantId, id) =>
      files.filter(
        (file) =>
          file.documentId === id &&
          documents.some(
            (document) => document.id === id && document.tenantId === tenantId,
          ),
      ),
    listFilesForDocuments: async (tenantId, ids) =>
      files.filter(
        (file) =>
          ids.includes(file.documentId) &&
          documents.some(
            (document) =>
              document.id === file.documentId &&
              document.tenantId === tenantId &&
              document.deletedAt === null,
          ),
      ),
    create: async (input) => {
      const created: Document = {
        ...input,
        draft: input.draft ?? false,
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
        deletedAt: null,
      };
      documents.push(created);
      return created;
    },
    update: async (tenantId, id, input) => {
      const index = documents.findIndex(
        (document) =>
          document.tenantId === tenantId && document.id === id && document.deletedAt === null,
      );
      const current = documents[index];
      if (!current) return null;
      const updated = { ...current, ...input, updatedAt: '2026-07-02T10:00:00.000Z' };
      documents[index] = updated;
      return updated;
    },
    approve: async (tenantId, id) => {
      const index = documents.findIndex(
        (document) => document.tenantId === tenantId && document.id === id,
      );
      const current = documents[index];
      if (!current) return null;
      const approved = { ...current, draft: false, updatedAt: '2026-07-02T10:00:00.000Z' };
      documents[index] = approved;
      return approved;
    },
    delete: async (tenantId, id) => {
      const index = documents.findIndex(
        (document) =>
          document.tenantId === tenantId && document.id === id && document.deletedAt === null,
      );
      if (index < 0) return false;
      const current = documents[index];
      if (!current) return false;
      documents[index] = {
        ...current,
        updatedAt: '2026-07-03T10:00:00.000Z',
        deletedAt: '2026-07-03T10:00:00.000Z',
      };
      return true;
    },
    restore: async (tenantId, id) => {
      const index = documents.findIndex(
        (document) =>
          document.tenantId === tenantId && document.id === id && document.deletedAt !== null,
      );
      const current = documents[index];
      if (!current) return null;
      const restored = {
        ...current,
        updatedAt: '2026-07-04T10:00:00.000Z',
        deletedAt: null,
      };
      documents[index] = restored;
      return restored;
    },
    purge: async (tenantId, id) => {
      const index = documents.findIndex(
        (document) => document.tenantId === tenantId && document.id === id,
      );
      if (index < 0) return false;
      documents.splice(index, 1);
      for (let fileIndex = files.length - 1; fileIndex >= 0; fileIndex -= 1) {
        if (files[fileIndex]?.documentId === id) files.splice(fileIndex, 1);
      }
      return true;
    },
    createFile: async (tenantId, input) => {
      if (
        !documents.some(
          (document) =>
            document.id === input.documentId &&
            document.tenantId === tenantId &&
            document.deletedAt === null,
        )
      ) {
        return null;
      }
      const created: DocumentFile = {
        ...input,
        createdAt: '2026-07-01T10:00:00.000Z',
      };
      files.push(created);
      return created;
    },
    updateFileSize: async (tenantId, id, idOfFile, sizeBytes) => {
      const index = files.findIndex(
        (file) =>
          file.id === idOfFile &&
          file.documentId === id &&
          documents.some(
            (document) => document.id === id && document.tenantId === tenantId,
          ),
      );
      const current = files[index];
      if (!current) return false;
      files[index] = { ...current, sizeBytes };
      return true;
    },
    findFile: async (tenantId, id, idOfFile) =>
      files.find(
        (file) =>
          file.id === idOfFile &&
          file.documentId === id &&
          documents.some(
            (document) =>
              document.id === id && document.tenantId === tenantId && document.deletedAt === null,
          ),
      ) ?? null,
    moveFileToDocument: async (tenantId, sourceDocumentId, idOfFile, targetDocumentId) => {
      const sourceOwned = documents.some(
        (document) =>
          document.id === sourceDocumentId &&
          document.tenantId === tenantId &&
          document.deletedAt === null,
      );
      const targetOwned = documents.some(
        (document) =>
          document.id === targetDocumentId &&
          document.tenantId === tenantId &&
          document.deletedAt === null,
      );
      const index = files.findIndex(
        (file) => file.id === idOfFile && file.documentId === sourceDocumentId,
      );
      const current = files[index];
      if (!sourceOwned || !targetOwned || !current) return null;
      const moved = { ...current, documentId: targetDocumentId };
      files[index] = moved;
      return moved;
    },
    deleteFile: async (tenantId, id, idOfFile) => {
      const index = files.findIndex(
        (file) =>
          file.id === idOfFile &&
          file.documentId === id &&
          documents.some(
            (document) =>
              document.id === id && document.tenantId === tenantId && document.deletedAt === null,
          ),
      );
      if (index < 0) return false;
      files.splice(index, 1);
      return true;
    },
  };

  const storage: StoragePort = {
    put: async (key, bytes) => {
      blobs.set(key, bytes);
      return ok(undefined);
    },
    get: async (key) => ok(blobs.get(key) ?? null),
    head: async (key) => {
      const bytes = blobs.get(key);
      return ok(bytes ? { contentType: 'application/pdf', sizeBytes: bytes.byteLength } : null);
    },
    delete: async (key) => {
      blobs.delete(key);
      return ok(undefined);
    },
    createUploadUrl: async () => ok(null),
  };

  const ids = [...idSequence];
  const deps: DocumentDeps = {
    documents: repo,
    storage,
    ids: { nextId: () => ids.shift() ?? fileId },
  };
  return {
    deps,
    documents,
    files,
    blobs,
  };
};

const ctx = (identity: Identity) => ({ identity });

const createInput = {
  title: 'Agreement',
  docType: 'umowa-uod' as const,
  documentDate: '2026-07-01',
  periodStart: null,
  periodEnd: null,
  tags: ['contract'],
};

describe('documents use-cases', () => {
  it('denies every document use-case before any repository access', async () => {
    const input = {
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
      role: 'source' as const,
    };
    const visitor = staff(null);
    const cases: Array<{
      name: string;
      run: (deps: DocumentDeps) => Promise<Result<unknown, AppError>>;
    }> = [
      { name: 'createDocument', run: (deps) => createDocument(ctx(member), createInput, deps) },
      { name: 'listDocuments', run: (deps) => listDocuments(ctx(visitor), {}, deps) },
      { name: 'getDocument', run: (deps) => getDocument(ctx(member), documentId, deps) },
      { name: 'listTrashedDocuments', run: (deps) => listTrashedDocuments(ctx(visitor), deps) },
      {
        name: 'updateDocument',
        run: (deps) => updateDocument(ctx(visitor), documentId, createInput, deps),
      },
      {
        name: 'approveDocument',
        run: (deps) => approveDocument(ctx(member), documentId, deps),
      },
      { name: 'deleteDocument', run: (deps) => deleteDocument(ctx(member), documentId, deps) },
      { name: 'restoreDocument', run: (deps) => restoreDocument(ctx(member), documentId, deps) },
      { name: 'purgeDocument', run: (deps) => purgeDocument(ctx(member), documentId, deps) },
      {
        name: 'requestFileUpload',
        run: (deps) => requestFileUpload(ctx(visitor), documentId, input, deps),
      },
      {
        name: 'finalizeFileUpload',
        run: (deps) =>
          finalizeFileUpload(
            ctx(member),
            documentId,
            { key: fileRow().storageKey, ...input, sizeBytes: 3 },
            deps,
          ),
      },
      {
        name: 'serverUpload',
        run: (deps) =>
          serverUpload(
            ctx(visitor),
            documentId,
            { ...input, bytes: new Uint8Array([1]) },
            deps,
          ),
      },
      {
        name: 'removeFile',
        run: (deps) => removeFile(ctx(member), documentId, fileId, deps),
      },
      {
        name: 'moveDocumentFile',
        run: (deps) =>
          moveDocumentFile(
            ctx(member),
            documentId,
            fileId,
            { title: 'Moved', docType: 'umowa-uod' },
            deps,
          ),
      },
      {
        name: 'getFileContent',
        run: (deps) => getFileContent(ctx(visitor), documentId, fileId, deps),
      },
      {
        name: 'getFileExport',
        run: (deps) => getFileExport(ctx(member), documentId, fileId, deps),
      },
      {
        name: 'exportDocuments',
        run: (deps) => exportDocuments(ctx(visitor), { documentIds: [documentId] }, deps),
      },
    ];
    for (const testCase of cases) {
      const state = fake([documentRow()], [fileRow()]);
      const repositorySpies = [
        vi.spyOn(state.deps.documents, 'listByTenant'),
        vi.spyOn(state.deps.documents, 'listDeletedByTenant'),
        vi.spyOn(state.deps.documents, 'findById'),
        vi.spyOn(state.deps.documents, 'findDeletedById'),
        vi.spyOn(state.deps.documents, 'findAnyById'),
        vi.spyOn(state.deps.documents, 'listFiles'),
        vi.spyOn(state.deps.documents, 'listFilesIncludingDeleted'),
        vi.spyOn(state.deps.documents, 'listFilesForDocuments'),
        vi.spyOn(state.deps.documents, 'create'),
        vi.spyOn(state.deps.documents, 'update'),
        vi.spyOn(state.deps.documents, 'approve'),
        vi.spyOn(state.deps.documents, 'delete'),
        vi.spyOn(state.deps.documents, 'restore'),
        vi.spyOn(state.deps.documents, 'purge'),
        vi.spyOn(state.deps.documents, 'createFile'),
        vi.spyOn(state.deps.documents, 'findFile'),
        vi.spyOn(state.deps.documents, 'moveFileToDocument'),
        vi.spyOn(state.deps.documents, 'deleteFile'),
      ];
      const result = await testCase.run(state.deps);
      expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      for (const repositorySpy of repositorySpies) {
        expect(
          repositorySpy,
          `${testCase.name} touched a repository before denial`,
        ).not.toHaveBeenCalled();
      }
    }
  });

  it('creates, filters by tenant, reads, updates and deletes an entry', async () => {
    const state = fake([documentRow('tenant-other')]);
    const created = await createDocument(ctx(staff('tenant-acme')), createInput, state.deps);
    expect(created).toMatchObject({ ok: true, value: { tenantId: 'tenant-acme' } });
    const listed = await listDocuments(ctx(staff('tenant-acme')), {}, state.deps);
    expect(listed.ok && listed.value.map((document) => document.id)).toEqual([documentId]);
    const listSpy = vi.spyOn(state.deps.documents, 'listByTenant');
    await listDocuments(
      ctx(staff('tenant-acme')),
      { signatureStatus: 'needs-signature' },
      state.deps,
    );
    expect(listSpy).toHaveBeenCalledWith('tenant-acme', {
      signatureStatus: 'needs-signature',
    });
    expect(await getDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toMatchObject({
      ok: true,
      value: { title: 'Agreement', files: [] },
    });
    expect(
      await updateDocument(
        ctx(staff('tenant-acme', 'admin')),
        documentId,
        { ...createInput, title: 'Updated' },
        state.deps,
      ),
    ).toMatchObject({ ok: true, value: { title: 'Updated' } });
    const draft = await createDocument(
      ctx(staff('tenant-acme')),
      { ...createInput, title: 'Draft', draft: true },
      state.deps,
    );
    expect(draft).toMatchObject({ ok: true, value: { draft: true } });
    if (!draft.ok) return;
    expect(await approveDocument(ctx(staff('tenant-acme')), draft.value.id, state.deps)).toMatchObject({
      ok: true,
      value: { draft: false },
    });
    expect(await deleteDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(state.documents[1]?.deletedAt).toBe('2026-07-03T10:00:00.000Z');
  });

  it('soft-deletes, lists trash with files, restores, and purges idempotently', async () => {
    const state = fake([documentRow()], [fileRow()]);
    const storageDelete = vi.spyOn(state.deps.storage, 'delete');

    expect(await deleteDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(storageDelete).not.toHaveBeenCalled();
    expect(await listDocuments(ctx(staff('tenant-acme')), {}, state.deps)).toEqual({
      ok: true,
      value: [],
    });
    expect(await listTrashedDocuments(ctx(staff('tenant-acme')), state.deps)).toMatchObject({
      ok: true,
      value: [{ id: documentId, deletedAt: '2026-07-03T10:00:00.000Z', files: [{ id: fileId }] }],
    });
    expect(await getDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toMatchObject({
      ok: true,
      value: { id: documentId, deletedAt: '2026-07-03T10:00:00.000Z', files: [{ id: fileId }] },
    });
    expect(await restoreDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toMatchObject({
      ok: true,
      value: { id: documentId, deletedAt: null },
    });
    expect(await listDocuments(ctx(staff('tenant-acme')), {}, state.deps)).toMatchObject({
      ok: true,
      value: [{ id: documentId, deletedAt: null }],
    });

    expect(await deleteDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await purgeDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(storageDelete).toHaveBeenCalledWith(fileRow().storageKey);
    expect(state.documents).toEqual([]);
    expect(state.files).toEqual([]);
    expect(await purgeDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(storageDelete).toHaveBeenCalledTimes(1);
  });

  it('does not expose trashed documents through active operations or other tenants', async () => {
    const state = fake([documentRow(), { ...documentRow('tenant-other'), id: movedDocumentId }], [fileRow()]);

    expect(await deleteDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await updateDocument(ctx(staff('tenant-acme')), documentId, createInput, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(
      await getFileContent(ctx(staff('tenant-acme')), documentId, fileId, state.deps),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await exportDocuments(ctx(staff('tenant-acme')), { documentIds: [documentId] }, state.deps),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await restoreDocument(ctx(staff('tenant-other')), documentId, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await purgeDocument(ctx(staff('tenant-other')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(state.documents.some((document) => document.id === documentId)).toBe(true);
  });

  it('enforces write:draft token restrictions on create, modify, delete, and approve', async () => {
    const draftToken = {
      ...staff('tenant-acme'),
      apiToken: { id: '55555555-5555-4555-8555-555555555555', scopes: ['write:draft'] as const },
    };
    const state = fake([documentRow(), { ...documentRow(), id: movedDocumentId, draft: true }]);
    expect(await createDocument(ctx(draftToken), createInput, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(
      await createDocument(ctx(draftToken), { ...createInput, draft: true }, state.deps),
    ).toMatchObject({ ok: true, value: { draft: true } });
    expect(
      await updateDocument(
        ctx(draftToken),
        documentId,
        { ...createInput, title: 'Nope' },
        state.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(
      await serverUpload(
        ctx(draftToken),
        movedDocumentId,
        {
          fileName: 'draft.pdf',
          contentType: 'application/pdf',
          role: 'source',
          bytes: new Uint8Array([1]),
        },
        state.deps,
      ),
    ).toMatchObject({ ok: true });
    expect(await deleteDocument(ctx(draftToken), movedDocumentId, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await approveDocument(ctx(draftToken), movedDocumentId, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('validates document input and filters before repository access', async () => {
    const state = fake();
    expect(
      await createDocument(
        ctx(staff('tenant-acme')),
        { ...createInput, title: ' ' },
        state.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      await listDocuments(
        ctx(staff('tenant-acme')),
        { dateFrom: '2026-08-01', dateTo: '2026-07-01' },
        state.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('requests, stores, finalizes, reads and removes a server upload', async () => {
    const state = fake([documentRow()]);
    const input = {
      fileName: 'agreement.pdf',
      contentType: 'application/pdf',
      role: 'source' as const,
    };
    expect(
      await requestFileUpload(ctx(staff('tenant-acme')), documentId, input, state.deps),
    ).toMatchObject({ ok: true, value: { kind: 'server' } });
    const uploaded = await serverUpload(
      ctx(staff('tenant-acme')),
      documentId,
      { ...input, bytes: new Uint8Array([1, 2, 3]) },
      state.deps,
    );
    expect(uploaded).toMatchObject({ ok: true, value: { fileName: 'agreement.pdf' } });
    if (!uploaded.ok) return;
    expect(
      await getFileContent(
        ctx(staff('tenant-acme')),
        documentId,
        uploaded.value.id,
        state.deps,
      ),
    ).toMatchObject({ ok: true, value: { contentType: 'application/pdf' } });
    expect(
      await removeFile(
        ctx(staff('tenant-acme')),
        documentId,
        uploaded.value.id,
        state.deps,
      ),
    ).toEqual({ ok: true, value: undefined });
  });

  it('keeps a signed-digital upload when sealing is enabled without certificate env', async () => {
    const state = fake([documentRow()]);
    const warn = vi.fn();
    state.deps.pdfSealing = {
      ids: state.deps.ids,
      pdfSeal: { configured: false },
      signatureRecords: {
        listByDocument: async () => [],
        create: async () => null,
        recordSeal: async () => {},
      },
      tenantSettings: {
        get: async () => ({
          tenantId: 'tenant-acme',
          storeSignatureRecords: true,
          pdfSealEnabled: true,
          dateMode: 'declared',
        }),
        set: async (tenantId, settings) => ({ tenantId, ...settings }),
      },
      warnings: { warn },
    };
    const uploaded = await serverUpload(
      ctx(staff('tenant-acme')),
      documentId,
      {
        fileName: 'agreement-signed.pdf',
        contentType: 'application/pdf',
        role: 'signed-digital',
        bytes: new Uint8Array([1, 2, 3]),
      },
      state.deps,
    );
    expect(uploaded).toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      'PDF seal skipped because certificate environment variables are absent',
      expect.objectContaining({ tenantId: 'tenant-acme', documentId }),
    );
  });

  it('checks the tenant seal flag before downloading a signed upload', async () => {
    const state = fake([documentRow()]);
    const get = vi.spyOn(state.deps.storage, 'get');
    state.deps.pdfSealing = {
      ids: state.deps.ids,
      pdfSeal: {
        configured: true,
        seal: async () => ({ kind: 'failed', reason: 'unexpected' }),
      },
      signatureRecords: {
        listByDocument: async () => [],
        create: async () => null,
        recordSeal: async () => {},
      },
      tenantSettings: {
        get: async () => ({
          tenantId: 'tenant-acme',
          storeSignatureRecords: true,
          pdfSealEnabled: false,
          dateMode: 'declared',
        }),
        set: async (tenantId, settings) => ({ tenantId, ...settings }),
      },
      warnings: { warn: vi.fn() },
    };
    await expect(serverUpload(
      ctx(staff('tenant-acme')),
      documentId,
      {
        fileName: 'agreement-signed.pdf',
        contentType: 'application/pdf',
        role: 'signed-digital',
        bytes: new Uint8Array([1, 2, 3]),
      },
      state.deps,
    )).resolves.toMatchObject({ ok: true });
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps the original upload when the sealed PDF exceeds the file limit', async () => {
    const state = fake([documentRow()]);
    const warn = vi.fn();
    const recordSeal = vi.fn(async () => {});
    state.deps.pdfSealing = {
      ids: state.deps.ids,
      pdfSeal: {
        configured: true,
        seal: async () => ({
          kind: 'sealed',
          bytes: new Uint8Array(MAX_DOCUMENT_FILE_BYTES + 1),
          subject: 'Fixture',
        }),
      },
      signatureRecords: {
        listByDocument: async () => [],
        create: async () => null,
        recordSeal,
      },
      tenantSettings: {
        get: async () => ({
          tenantId: 'tenant-acme',
          storeSignatureRecords: true,
          pdfSealEnabled: true,
          dateMode: 'declared',
        }),
        set: async (tenantId, settings) => ({ tenantId, ...settings }),
      },
      warnings: { warn },
    };
    const original = new Uint8Array([1, 2, 3]);
    const uploaded = await serverUpload(
      ctx(staff('tenant-acme')),
      documentId,
      {
        fileName: 'agreement-signed.pdf',
        contentType: 'application/pdf',
        role: 'signed-digital',
        bytes: original,
      },
      state.deps,
    );
    expect(uploaded).toMatchObject({ ok: true, value: { sizeBytes: original.byteLength } });
    if (!uploaded.ok) return;
    expect(state.blobs.get(uploaded.value.storageKey)).toEqual(original);
    expect(recordSeal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('preserving the uploaded PDF'),
      expect.objectContaining({ reason: 'size-limit' }),
    );
  });

  it('moves a file into a new document with copied metadata defaults', async () => {
    const state = fake([documentRow()], [fileRow()], [movedDocumentId]);
    const moved = await moveDocumentFile(
      ctx(staff('tenant-acme')),
      documentId,
      fileId,
      { title: 'Moved file', docType: 'protokol' },
      state.deps,
    );

    expect(moved).toMatchObject({
      ok: true,
      value: {
        id: movedDocumentId,
        title: 'Moved file',
        docType: 'protokol',
        documentDate: '2026-07-01',
        tags: ['contract'],
        files: [{ id: fileId, documentId: movedDocumentId }],
      },
    });
    expect(state.files[0]?.documentId).toBe(movedDocumentId);
  });

  it('does not create a move target for cross-tenant or missing-file requests', async () => {
    const crossTenant = fake([documentRow()], [fileRow()], [movedDocumentId]);
    expect(
      await moveDocumentFile(
        ctx(staff('tenant-other')),
        documentId,
        fileId,
        { title: 'Moved file', docType: 'protokol' },
        crossTenant.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(crossTenant.documents).toHaveLength(1);

    const missingFile = fake([documentRow()], [], [movedDocumentId]);
    expect(
      await moveDocumentFile(
        ctx(staff('tenant-acme')),
        documentId,
        fileId,
        { title: 'Moved file', docType: 'protokol' },
        missingFile.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(missingFile.documents).toHaveLength(1);
  });

  it('cleans up the move target when the file move reports not_found', async () => {
    const state = fake([documentRow()], [fileRow()], [movedDocumentId]);
    expect(
      await moveDocumentFile(
        ctx(staff('tenant-acme')),
        documentId,
        fileId,
        { title: 'Moved file', docType: 'protokol' },
        {
          ...state.deps,
          documents: { ...state.deps.documents, moveFileToDocument: async () => null },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(state.documents.map((document) => document.id)).toEqual([documentId]);
  });

  it('finalizes only tenant-owned existing storage keys and exports stored files', async () => {
    const state = fake([documentRow()], [fileRow()]);
    expect(
      await finalizeFileUpload(
        ctx(staff('tenant-acme')),
        documentId,
        {
          key: 'documents/tenant-other/invalid',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          role: 'other',
        },
        state.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      await exportDocuments(
        ctx(staff('tenant-acme')),
        { documentIds: [documentId] },
        state.deps,
      ),
    ).toMatchObject({
      ok: true,
      value: [{ document: { id: documentId }, files: [{ file: { id: fileId } }] }],
    });
  });

  it.each([
    {
      name: 'content type',
      declared: { contentType: 'image/png', sizeBytes: 3 },
    },
    {
      name: 'size',
      declared: { contentType: 'application/pdf', sizeBytes: 2 },
    },
  ])(
    'rejects finalization when the declared $name differs from storage metadata',
    async ({ declared }) => {
      const state = fake([documentRow()], [fileRow()]);
      const before = state.files.length;
      expect(
        await finalizeFileUpload(
          ctx(staff('tenant-acme')),
          documentId,
          {
            key: fileRow().storageKey,
            fileName: 'scan.pdf',
            role: 'source',
            ...declared,
          },
          state.deps,
        ),
      ).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(state.files).toHaveLength(before);
    },
  );

  it('returns not_found for unknown entries, files and exports', async () => {
    const state = fake();
    expect(await getDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(
      await getFileContent(ctx(staff('tenant-acme')), documentId, fileId, state.deps),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await exportDocuments(
        ctx(staff('tenant-acme')),
        { documentIds: [documentId] },
        state.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects a bulk export containing more than 100 files', async () => {
    const files = Array.from({ length: 101 }, (_, index): DocumentFile => {
      const id = `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
      return {
        ...fileRow(),
        id,
        storageKey: `documents/tenant-acme/${documentId}/${id}`,
      };
    });
    const state = fake([documentRow()], files);
    expect(
      await exportDocuments(
        ctx(staff('tenant-acme')),
        { documentIds: [documentId] },
        state.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('allows a bulk export exactly at the aggregate byte cap', async () => {
    const sizes = [
      ...Array.from({ length: 10 }, () => MAX_DOCUMENT_FILE_BYTES),
      MAX_DOCUMENT_EXPORT_BYTES - 10 * MAX_DOCUMENT_FILE_BYTES,
    ];
    const files = sizes.map((sizeBytes, index): DocumentFile => {
      const id = `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
      return {
        ...fileRow(),
        id,
        sizeBytes,
        storageKey: `documents/tenant-acme/${documentId}/${id}`,
      };
    });
    const state = fake([documentRow()], files);
    const get = vi.spyOn(state.deps.storage, 'get');
    expect(
      await exportDocuments(
        ctx(staff('tenant-acme')),
        { documentIds: [documentId] },
        state.deps,
      ),
    ).toMatchObject({ ok: true });
    expect(get).toHaveBeenCalledTimes(files.length);
  });

  it('rejects an over-cap bulk export before fetching the next file', async () => {
    const sizes = [
      ...Array.from({ length: 10 }, () => MAX_DOCUMENT_FILE_BYTES),
      MAX_DOCUMENT_EXPORT_BYTES - 10 * MAX_DOCUMENT_FILE_BYTES,
      1,
    ];
    const files = sizes.map((sizeBytes, index): DocumentFile => {
      const id = `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
      return {
        ...fileRow(),
        id,
        sizeBytes,
        storageKey: `documents/tenant-acme/${documentId}/${id}`,
      };
    });
    const state = fake([documentRow()], files);
    const get = vi.spyOn(state.deps.storage, 'get');
    expect(
      await exportDocuments(
        ctx(staff('tenant-acme')),
        { documentIds: [documentId] },
        state.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'export_too_large' } });
    expect(get).toHaveBeenCalledTimes(files.length - 1);
  });

  it('lets repository failures reject for normalization at the composition edge', async () => {
    const state = fake([documentRow()], [fileRow()]);
    const failure = new Error('failed port');
    const failedRepo: DocumentRepository = {
      ...state.deps.documents,
      listByTenant: async () => Promise.reject(failure),
      listDeletedByTenant: async () => Promise.reject(failure),
      findById: async () => Promise.reject(failure),
      findDeletedById: async () => Promise.reject(failure),
      findAnyById: async () => Promise.reject(failure),
      update: async () => Promise.reject(failure),
      findFile: async () => Promise.reject(failure),
    };
    const failedDeps = { ...state.deps, documents: failedRepo };
    await expect(listDocuments(ctx(staff('tenant-acme')), {}, failedDeps)).rejects.toBe(failure);
    await expect(
      getDocument(ctx(staff('tenant-acme')), documentId, failedDeps),
    ).rejects.toBe(failure);
    await expect(
      listTrashedDocuments(ctx(staff('tenant-acme')), failedDeps),
    ).rejects.toBe(failure);
    await expect(
      updateDocument(ctx(staff('tenant-acme')), documentId, createInput, failedDeps),
    ).rejects.toBe(failure);
    await expect(
      requestFileUpload(
        ctx(staff('tenant-acme')),
        documentId,
        {
          fileName: 'scan.pdf',
          contentType: 'application/pdf',
          role: 'source',
        },
        failedDeps,
      ),
    ).rejects.toBe(failure);
    await expect(
      removeFile(ctx(staff('tenant-acme')), documentId, fileId, failedDeps),
    ).rejects.toBe(failure);
    await expect(
      getFileContent(ctx(staff('tenant-acme')), documentId, fileId, failedDeps),
    ).rejects.toBe(failure);
    await expect(
      getFileExport(ctx(staff('tenant-acme')), documentId, fileId, failedDeps),
    ).rejects.toBe(failure);
    await expect(
      exportDocuments(
        ctx(staff('tenant-acme')),
        { documentIds: [documentId] },
        failedDeps,
      ),
    ).rejects.toBe(failure);
  });

  it('covers direct-upload and missing-storage outcomes', async () => {
    const state = fake([documentRow()], [fileRow()]);
    const directStorage: StoragePort = {
      ...state.deps.storage,
      createUploadUrl: async () =>
        ok({
          url: 'https://uploads.example.test',
          method: 'PUT',
          headers: { authorization: 'Bearer token' },
        }),
    };
    expect(
      await requestFileUpload(
        ctx(staff('tenant-acme')),
        documentId,
        {
          fileName: 'scan.pdf',
          contentType: 'application/pdf',
          role: 'source',
        },
        { ...state.deps, storage: directStorage },
      ),
    ).toMatchObject({ ok: true, value: { kind: 'direct' } });

    const missingStorage: StoragePort = {
      ...state.deps.storage,
      head: async () => ok(null),
      get: async () => ok(null),
    };
    expect(
      await finalizeFileUpload(
        ctx(staff('tenant-acme')),
        documentId,
        {
          key: fileRow().storageKey,
          fileName: 'scan.pdf',
          contentType: 'application/pdf',
          sizeBytes: 3,
          role: 'source',
        },
        { ...state.deps, storage: missingStorage },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await getFileContent(
        ctx(staff('tenant-acme')),
        documentId,
        fileId,
        { ...state.deps, storage: missingStorage },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await getFileExport(
        ctx(staff('tenant-acme')),
        documentId,
        fileId,
        { ...state.deps, storage: missingStorage },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('propagates delete, purge and upload failures and reports vanished rows', async () => {
    const state = fake([documentRow()], [fileRow()]);
    const failure = err(internal('failed port'));
    expect(
      await deleteDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          storage: { ...state.deps.storage, delete: async () => failure },
        },
      ),
    ).toEqual({ ok: true, value: undefined });
    await expect(
      purgeDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          documents: {
            ...state.deps.documents,
            listAllFilesIncludingDeleted: async () => Promise.reject(new Error('failed port')),
          },
        },
      ),
    ).rejects.toThrow('failed port');
    expect(
      await purgeDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          storage: { ...state.deps.storage, delete: async () => failure },
        },
      ),
    ).toEqual(failure);
    await expect(
      deleteDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          documents: {
            ...state.deps.documents,
            delete: async () => Promise.reject(new Error('failed port')),
          },
        },
      ),
    ).rejects.toThrow('failed port');
    expect(
      await deleteDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          documents: { ...state.deps.documents, delete: async () => false },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const input = {
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
      role: 'source' as const,
      bytes: new Uint8Array([1]),
    };
    const uploadState = fake([documentRow()], [fileRow()]);
    expect(
      await serverUpload(
        ctx(staff('tenant-acme')),
        documentId,
        input,
        {
          ...uploadState.deps,
          storage: { ...uploadState.deps.storage, put: async () => failure },
        },
      ),
    ).toEqual(failure);
    expect(
      await serverUpload(
        ctx(staff('tenant-acme')),
        documentId,
        input,
        {
          ...uploadState.deps,
          documents: { ...uploadState.deps.documents, createFile: async () => null },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
