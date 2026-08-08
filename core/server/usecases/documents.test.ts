import { describe, expect, it } from 'vitest';

import {
  err,
  internal,
  ok,
  type Document,
  type DocumentFile,
  type Identity,
} from '#core/domain/index.js';

import type { DocumentRepository, StoragePort } from '../ports.js';
import {
  createDocument,
  deleteDocument,
  exportDocuments,
  finalizeFileUpload,
  getDocument,
  getFileContent,
  getFileExport,
  listDocuments,
  removeFile,
  requestFileUpload,
  serverUpload,
  updateDocument,
} from './documents.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const uploadId = '33333333-3333-4333-8333-333333333333';

const staff = (tenantId: string | null, role: 'owner' | 'admin' = 'owner'): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme Inc' : null,
  staffRole: tenantId ? role : null,
  memberId: null,
});

const member: Identity = {
  userId: 'u2',
  email: 'member@example.com',
  name: 'Member',
  tenantId: 'tenant-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: null,
  memberId: 'member-1',
};

const documentRow = (tenantId = 'tenant-acme'): Document => ({
  id: documentId,
  tenantId,
  title: 'Agreement',
  docType: 'umowa-uod',
  documentDate: '2026-07-01',
  person: null,
  tags: ['contract'],
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
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

const fake = (initialDocuments: Document[] = [], initialFiles: DocumentFile[] = []) => {
  const documents = [...initialDocuments];
  const files = [...initialFiles];
  const blobs = new Map<string, Uint8Array>();
  for (const file of files) blobs.set(file.storageKey, new Uint8Array([1, 2, 3]));

  const repo: DocumentRepository = {
    listByTenant: async (tenantId) =>
      ok(documents.filter((document) => document.tenantId === tenantId)),
    findById: async (tenantId, id) =>
      ok(documents.find((document) => document.tenantId === tenantId && document.id === id) ?? null),
    listFiles: async (tenantId, id) =>
      ok(
        files.filter(
          (file) =>
            file.documentId === id &&
            documents.some(
              (document) => document.id === id && document.tenantId === tenantId,
            ),
        ),
      ),
    listFilesForDocuments: async (tenantId, ids) =>
      ok(
        files.filter(
          (file) =>
            ids.includes(file.documentId) &&
            documents.some(
              (document) =>
                document.id === file.documentId && document.tenantId === tenantId,
            ),
        ),
      ),
    create: async (input) => {
      const created: Document = {
        ...input,
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      };
      documents.push(created);
      return ok(created);
    },
    update: async (tenantId, id, input) => {
      const index = documents.findIndex(
        (document) => document.tenantId === tenantId && document.id === id,
      );
      const current = documents[index];
      if (!current) return ok(null);
      const updated = { ...current, ...input, updatedAt: '2026-07-02T10:00:00.000Z' };
      documents[index] = updated;
      return ok(updated);
    },
    delete: async (tenantId, id) => {
      const index = documents.findIndex(
        (document) => document.tenantId === tenantId && document.id === id,
      );
      if (index < 0) return ok(false);
      documents.splice(index, 1);
      return ok(true);
    },
    createFile: async (tenantId, input) => {
      if (!documents.some((document) => document.id === input.documentId && document.tenantId === tenantId)) {
        return ok(null);
      }
      const created: DocumentFile = {
        ...input,
        createdAt: '2026-07-01T10:00:00.000Z',
      };
      files.push(created);
      return ok(created);
    },
    findFile: async (tenantId, id, idOfFile) =>
      ok(
        files.find(
          (file) =>
            file.id === idOfFile &&
            file.documentId === id &&
            documents.some(
              (document) => document.id === id && document.tenantId === tenantId,
            ),
        ) ?? null,
      ),
    deleteFile: async (tenantId, id, idOfFile) => {
      const index = files.findIndex(
        (file) =>
          file.id === idOfFile &&
          file.documentId === id &&
          documents.some(
            (document) => document.id === id && document.tenantId === tenantId,
          ),
      );
      if (index < 0) return ok(false);
      files.splice(index, 1);
      return ok(true);
    },
  };

  const storage: StoragePort = {
    put: async (key, bytes) => {
      blobs.set(key, bytes);
      return ok(undefined);
    },
    get: async (key) => ok(blobs.get(key) ?? null),
    exists: async (key) => ok(blobs.has(key)),
    delete: async (key) => {
      blobs.delete(key);
      return ok(undefined);
    },
    createUploadUrl: async () => ok(null),
  };

  const ids = [documentId, uploadId, fileId];
  return {
    deps: {
      documents: repo,
      storage,
      ids: { nextId: () => ids.shift() ?? fileId },
    },
    documents,
    files,
    blobs,
  };
};

const ctx = (identity: Identity) => ({ identity, tenantCreationMode: 'open' as const });

const createInput = {
  title: 'Agreement',
  docType: 'umowa-uod' as const,
  documentDate: '2026-07-01',
  tags: ['contract'],
};

describe('documents use-cases', () => {
  it('authorizes before repository access and keeps the aggregate staff-only', async () => {
    const state = fake();
    expect(await listDocuments(ctx(staff(null)), {}, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await createDocument(ctx(member), createInput, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(state.documents).toHaveLength(0);
  });

  it('denies every document operation to a member before touching its ports', async () => {
    const state = fake([documentRow()], [fileRow()]);
    const input = {
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
      role: 'source' as const,
    };
    const calls = [
      getDocument(ctx(member), documentId, state.deps),
      updateDocument(ctx(member), documentId, createInput, state.deps),
      deleteDocument(ctx(member), documentId, state.deps),
      requestFileUpload(ctx(member), documentId, input, state.deps),
      finalizeFileUpload(
        ctx(member),
        documentId,
        {
          key: fileRow().storageKey,
          ...input,
          sizeBytes: 3,
        },
        state.deps,
      ),
      serverUpload(
        ctx(member),
        documentId,
        { ...input, bytes: new Uint8Array([1]) },
        state.deps,
      ),
      removeFile(ctx(member), documentId, fileId, state.deps),
      getFileContent(ctx(member), documentId, fileId, state.deps),
      getFileExport(ctx(member), documentId, fileId, state.deps),
      exportDocuments(ctx(member), { documentIds: [documentId] }, state.deps),
    ];
    for (const result of await Promise.all(calls)) {
      expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
  });

  it('creates, filters by tenant, reads, updates and deletes an entry', async () => {
    const state = fake([documentRow('tenant-other')]);
    const created = await createDocument(ctx(staff('tenant-acme')), createInput, state.deps);
    expect(created).toMatchObject({ ok: true, value: { tenantId: 'tenant-acme' } });
    const listed = await listDocuments(ctx(staff('tenant-acme')), {}, state.deps);
    expect(listed.ok && listed.value.map((document) => document.id)).toEqual([documentId]);
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
    expect(await deleteDocument(ctx(staff('tenant-acme')), documentId, state.deps)).toEqual({
      ok: true,
      value: undefined,
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

  it('propagates repository and storage failures without normalizing them in core', async () => {
    const state = fake([documentRow()], [fileRow()]);
    const failure = err(internal('failed port'));
    const failedRepo: DocumentRepository = {
      ...state.deps.documents,
      listByTenant: async () => failure,
      findById: async () => failure,
      update: async () => failure,
      findFile: async () => failure,
    };
    const failedDeps = { ...state.deps, documents: failedRepo };
    expect(await listDocuments(ctx(staff('tenant-acme')), {}, failedDeps)).toEqual(failure);
    expect(await getDocument(ctx(staff('tenant-acme')), documentId, failedDeps)).toEqual(failure);
    expect(
      await updateDocument(ctx(staff('tenant-acme')), documentId, createInput, failedDeps),
    ).toEqual(failure);
    expect(
      await requestFileUpload(
        ctx(staff('tenant-acme')),
        documentId,
        {
          fileName: 'scan.pdf',
          contentType: 'application/pdf',
          role: 'source',
        },
        failedDeps,
      ),
    ).toEqual(failure);
    expect(
      await removeFile(ctx(staff('tenant-acme')), documentId, fileId, failedDeps),
    ).toEqual(failure);
    expect(
      await getFileContent(ctx(staff('tenant-acme')), documentId, fileId, failedDeps),
    ).toEqual(failure);
    expect(
      await getFileExport(ctx(staff('tenant-acme')), documentId, fileId, failedDeps),
    ).toEqual(failure);
    expect(
      await exportDocuments(
        ctx(staff('tenant-acme')),
        { documentIds: [documentId] },
        failedDeps,
      ),
    ).toEqual(failure);
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
      exists: async () => ok(false),
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

  it('propagates delete and upload failures and reports vanished rows', async () => {
    const state = fake([documentRow()], [fileRow()]);
    const failure = err(internal('failed port'));
    expect(
      await deleteDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          documents: { ...state.deps.documents, listFiles: async () => failure },
        },
      ),
    ).toEqual(failure);
    expect(
      await deleteDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          storage: { ...state.deps.storage, delete: async () => failure },
        },
      ),
    ).toEqual(failure);
    expect(
      await deleteDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          documents: { ...state.deps.documents, delete: async () => failure },
        },
      ),
    ).toEqual(failure);
    expect(
      await deleteDocument(
        ctx(staff('tenant-acme')),
        documentId,
        {
          ...state.deps,
          documents: { ...state.deps.documents, delete: async () => ok(false) },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const input = {
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
      role: 'source' as const,
      bytes: new Uint8Array([1]),
    };
    expect(
      await serverUpload(
        ctx(staff('tenant-acme')),
        documentId,
        input,
        {
          ...state.deps,
          storage: { ...state.deps.storage, put: async () => failure },
        },
      ),
    ).toEqual(failure);
    expect(
      await serverUpload(
        ctx(staff('tenant-acme')),
        documentId,
        input,
        {
          ...state.deps,
          documents: { ...state.deps.documents, createFile: async () => ok(null) },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
