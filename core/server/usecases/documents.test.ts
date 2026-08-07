import { describe, expect, it } from 'vitest';

import {
  err,
  internal,
  ok,
  type Document,
  type DocumentFile,
  type DocumentListFilter,
  type Identity,
} from '#core/domain/index.js';

import type { DocumentRepository, StoragePort } from '../ports.js';
import {
  createDocument,
  deleteDocument,
  finalizeFileUpload,
  getFileContent,
  getDocument,
  listDocuments,
  removeFile,
  requestFileUpload,
  serverUpload,
  updateDocument,
} from './documents.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'default' : null,
  tenantName: tenantId ? 'Default' : null,
  staffRole: tenantId ? 'owner' : null,
  memberId: null,
});

const document = (id: string, tenantId = 't-default'): Document => ({
  id,
  tenantId,
  title: `Title ${id}`,
  docType: 'uchwala',
  documentDate: '2026-07-18',
  tags: [],
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
});

const fakeRepository = (initial: Document[] = []) => {
  const documents = [...initial];
  const files: DocumentFile[] = [];
  const repo: DocumentRepository = {
    listByTenant: async (tenantId, filter) =>
      ok(
        documents
          .filter((row) => row.tenantId === tenantId)
          .filter((row) => !filter.docType || row.docType === filter.docType)
          .filter((row) => !filter.person || row.person === filter.person)
          .filter((row) => !filter.text || row.title.toLowerCase().includes(filter.text.toLowerCase()))
          .filter((row) => !filter.dateFrom || row.documentDate >= filter.dateFrom)
          .filter((row) => !filter.dateTo || row.documentDate <= filter.dateTo)
          .sort((left, right) => right.documentDate.localeCompare(left.documentDate)),
      ),
    findById: async (tenantId, documentId) =>
      ok(documents.find((row) => row.tenantId === tenantId && row.id === documentId) ?? null),
    listFiles: async (tenantId, documentId) =>
      ok(
        documents.some((row) => row.tenantId === tenantId && row.id === documentId)
          ? files.filter((file) => file.documentId === documentId)
          : [],
      ),
    create: async (input) => {
      const created = {
        ...input,
        createdAt: '2026-07-18T10:00:00.000Z',
        updatedAt: '2026-07-18T10:00:00.000Z',
      };
      documents.push(created);
      return ok(created);
    },
    update: async (tenantId, documentId, input) => {
      const index = documents.findIndex((row) => row.tenantId === tenantId && row.id === documentId);
      const current = documents[index];
      if (!current) return ok(null);
      const updated = { ...current, ...input, updatedAt: '2026-07-19T10:00:00.000Z' };
      documents[index] = updated;
      return ok(updated);
    },
    delete: async (tenantId, documentId) => {
      const index = documents.findIndex((row) => row.tenantId === tenantId && row.id === documentId);
      if (index < 0) return ok(false);
      documents.splice(index, 1);
      return ok(true);
    },
    createFile: async (tenantId, input) => {
      if (!documents.some((row) => row.tenantId === tenantId && row.id === input.documentId)) {
        return ok(null);
      }
      const created = { ...input, createdAt: '2026-07-18T10:00:00.000Z' };
      files.push(created);
      return ok(created);
    },
    findFile: async (tenantId, documentId, fileId) =>
      ok(
        documents.some((row) => row.tenantId === tenantId && row.id === documentId)
          ? files.find((file) => file.documentId === documentId && file.id === fileId) ?? null
          : null,
      ),
    deleteFile: async (tenantId, documentId, fileId) => {
      if (!documents.some((row) => row.tenantId === tenantId && row.id === documentId)) return ok(false);
      const index = files.findIndex((file) => file.documentId === documentId && file.id === fileId);
      if (index < 0) return ok(false);
      files.splice(index, 1);
      return ok(true);
    },
  };
  return { repo, documents, files };
};

const fakeStorage = (direct = false) => {
  const objects = new Map<string, Uint8Array>();
  const storage: StoragePort = {
    put: async (key, bytes) => {
      objects.set(key, bytes);
      return ok(undefined);
    },
    get: async (key) => ok(objects.get(key) ?? null),
    exists: async (key) => ok(objects.has(key)),
    delete: async (key) => {
      objects.delete(key);
      return ok(undefined);
    },
    createUploadUrl: async () =>
      ok(direct ? { url: 'https://upload.example', method: 'PUT', headers: { authorization: 'token' } } : null),
  };
  return { storage, objects };
};

const deps = (repo: DocumentRepository, storage: StoragePort, ids: string[] = ['document-1']) => ({
  documents: repo,
  storage,
  ids: { nextId: () => ids.shift() ?? 'generated-id' },
});

const createInput = {
  title: 'Agreement',
  docType: 'umowa-uod' as const,
  documentDate: '2026-07-18',
};

describe('documents use-cases', () => {
  it('creates with tenant scope and default tags', async () => {
    const repository = fakeRepository();
    const storage = fakeStorage();
    const result = await createDocument(
      { identity: identity('t-default') },
      createInput,
      deps(repository.repo, storage.storage),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { id: 'document-1', tenantId: 't-default', tags: [], title: 'Agreement' },
    });
  });

  it('validates create and all use-cases require a tenant', async () => {
    const repository = fakeRepository();
    const storage = fakeStorage();
    const usecaseDeps = deps(repository.repo, storage.storage);
    const invalid = await createDocument(
      { identity: identity('t-default') },
      { ...createInput, title: '' },
      usecaseDeps,
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });

    const ctx = { identity: identity(null) };
    const results = await Promise.all([
      createDocument(ctx, createInput, usecaseDeps),
      listDocuments(ctx, {}, usecaseDeps),
      getDocument(ctx, 'doc-1', usecaseDeps),
      updateDocument(ctx, 'doc-1', createInput, usecaseDeps),
      deleteDocument(ctx, 'doc-1', usecaseDeps),
      requestFileUpload(ctx, 'doc-1', { fileName: 'a.pdf', contentType: 'application/pdf', role: 'source' }, usecaseDeps),
      finalizeFileUpload(ctx, 'doc-1', { key: 'x', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1, role: 'source' }, usecaseDeps),
      getFileContent(ctx, 'doc-1', 'file-1', usecaseDeps),
      removeFile(ctx, 'doc-1', 'file-1', usecaseDeps),
    ]);
    expect(results.every((result) => !result.ok && result.error.code === 'tenant_not_found')).toBe(true);
  });

  it('filters and sorts the tenant list without leaking another tenant', async () => {
    const first = { ...document('one'), title: 'Board resolution', documentDate: '2026-01-02', person: 'Ada' };
    const second = { ...document('two'), title: 'Older resolution', documentDate: '2026-01-01', person: 'Ada' };
    const repository = fakeRepository([second, document('other', 't-other'), first]);
    const storage = fakeStorage();
    const filter: DocumentListFilter = { docType: 'uchwala', person: 'Ada', text: 'resolution' };
    const result = await listDocuments(
      { identity: identity('t-default') },
      filter,
      deps(repository.repo, storage.storage),
    );
    expect(result.ok && result.value.map((row) => row.id)).toEqual(['one', 'two']);
  });

  it('reads files, updates, deletes, and maps missing rows to not_found', async () => {
    const repository = fakeRepository([document('doc-1')]);
    repository.files.push({
      id: 'file-1',
      documentId: 'doc-1',
      role: 'source',
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12,
      storageKey: 'key',
      createdAt: '2026-07-18T10:00:00.000Z',
    });
    const storage = fakeStorage();
    const usecaseDeps = deps(repository.repo, storage.storage);
    const read = await getDocument({ identity: identity('t-default') }, 'doc-1', usecaseDeps);
    expect(read).toMatchObject({ ok: true, value: { files: [{ id: 'file-1' }] } });
    const updated = await updateDocument(
      { identity: identity('t-default') },
      'doc-1',
      { ...createInput, title: 'Updated', tags: ['signed'] },
      usecaseDeps,
    );
    expect(updated).toMatchObject({ ok: true, value: { title: 'Updated', tags: ['signed'] } });
    expect(await deleteDocument({ identity: identity('t-default') }, 'doc-1', usecaseDeps)).toEqual(ok(undefined));
    expect(await getDocument({ identity: identity('t-default') }, 'doc-1', usecaseDeps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('reads tenant-owned file content with its metadata', async () => {
    const repository = fakeRepository([document('doc-1')]);
    repository.files.push({
      id: 'file-1',
      documentId: 'doc-1',
      role: 'source',
      fileName: 'źródło.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'content-key',
      createdAt: '2026-07-18T10:00:00.000Z',
    });
    const storage = fakeStorage();
    storage.objects.set('content-key', new Uint8Array([1, 2, 3]));
    const result = await getFileContent(
      { identity: identity('t-default') },
      'doc-1',
      'file-1',
      deps(repository.repo, storage.storage),
    );
    expect(result).toEqual(
      ok({ bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf', fileName: 'źródło.pdf' }),
    );
    expect(
      await getFileContent(
        { identity: identity('t-default') },
        'doc-1',
        'missing',
        deps(repository.repo, storage.storage),
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('returns direct and server upload targets and finalizes tenant-owned keys', async () => {
    const repository = fakeRepository([document('doc-1')]);
    const directStorage = fakeStorage(true);
    const direct = await requestFileUpload(
      { identity: identity('t-default') },
      'doc-1',
      { fileName: 'a.pdf', contentType: 'application/pdf', role: 'source' },
      deps(repository.repo, directStorage.storage, ['file-key']),
    );
    expect(direct).toMatchObject({ ok: true, value: { kind: 'direct', key: 'documents/t-default/doc-1/file-key' } });

    const localStorage = fakeStorage();
    const local = await requestFileUpload(
      { identity: identity('t-default') },
      'doc-1',
      { fileName: 'a.pdf', contentType: 'application/pdf', role: 'source' },
      deps(repository.repo, localStorage.storage, ['local-key']),
    );
    expect(local).toMatchObject({ ok: true, value: { kind: 'server' } });

    localStorage.objects.set(
      'documents/t-default/doc-1/direct-key',
      new Uint8Array([1, 2, 3]),
    );

    const finalized = await finalizeFileUpload(
      { identity: identity('t-default') },
      'doc-1',
      {
        key: 'documents/t-default/doc-1/direct-key',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 3,
        role: 'source',
      },
      deps(repository.repo, localStorage.storage, ['file-1']),
    );
    expect(finalized).toMatchObject({ ok: true, value: { id: 'file-1', sizeBytes: 3 } });

    const missingObject = await finalizeFileUpload(
      { identity: identity('t-default') },
      'doc-1',
      {
        key: 'documents/t-default/doc-1/missing',
        fileName: 'missing.pdf',
        contentType: 'application/pdf',
        sizeBytes: 3,
        role: 'source',
      },
      deps(repository.repo, localStorage.storage, ['file-2']),
    );
    expect(missingObject).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(repository.files).toHaveLength(1);

    localStorage.storage.exists = async () => err(internal('stat failed'));
    expect(
      await finalizeFileUpload(
        { identity: identity('t-default') },
        'doc-1',
        {
          key: 'documents/t-default/doc-1/unavailable',
          fileName: 'unavailable.pdf',
          contentType: 'application/pdf',
          sizeBytes: 3,
          role: 'source',
        },
        deps(repository.repo, localStorage.storage),
      ),
    ).toEqual(err(internal('stat failed')));
    const invalidKey = await finalizeFileUpload(
      { identity: identity('t-default') },
      'doc-1',
      { key: 'documents/t-other/doc-1/x', fileName: 'a', contentType: 'x', sizeBytes: 1, role: 'other' },
      deps(repository.repo, localStorage.storage),
    );
    expect(invalidKey).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('uploads through storage and removes the blob before its row', async () => {
    const repository = fakeRepository([document('doc-1')]);
    const storage = fakeStorage();
    const uploaded = await serverUpload(
      { identity: identity('t-default') },
      'doc-1',
      { fileName: 'a.pdf', contentType: 'application/pdf', role: 'signed-scan', bytes: new Uint8Array([1, 2, 3]) },
      deps(repository.repo, storage.storage, ['storage-id', 'file-id']),
    );
    expect(uploaded).toMatchObject({ ok: true, value: { id: 'file-id', sizeBytes: 3 } });
    const key = 'documents/t-default/doc-1/storage-id';
    expect(storage.objects.has(key)).toBe(true);
    expect(await removeFile({ identity: identity('t-default') }, 'doc-1', 'file-id', deps(repository.repo, storage.storage))).toEqual(ok(undefined));
    expect(storage.objects.has(key)).toBe(false);
    expect(repository.files).toHaveLength(0);
  });

  it('propagates adapter failures as Results', async () => {
    const repository = fakeRepository([document('doc-1')]);
    repository.repo.findById = async () => ({ ok: false, error: internal('database unavailable') });
    const storage = fakeStorage();
    const result = await getDocument(
      { identity: identity('t-default') },
      'doc-1',
      deps(repository.repo, storage.storage),
    );
    expect(result).toEqual({ ok: false, error: internal('database unavailable') });
  });

  it('maps validation, missing rows, and storage failures without throwing', async () => {
    const ctx = { identity: identity('t-default') };
    const repository = fakeRepository([document('doc-1')]);
    const storage = fakeStorage();
    const usecaseDeps = deps(repository.repo, storage.storage, ['key-1', 'file-1']);

    expect(await listDocuments(ctx, { dateFrom: '2026-07-19', dateTo: '2026-07-18' }, usecaseDeps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await updateDocument(ctx, 'doc-1', { ...createInput, title: '' }, usecaseDeps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await requestFileUpload(ctx, 'doc-1', { fileName: '', contentType: 'x', role: 'other' }, usecaseDeps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await finalizeFileUpload(ctx, 'doc-1', { key: 'x', fileName: 'x', contentType: 'x', sizeBytes: -1, role: 'other' }, usecaseDeps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await updateDocument(ctx, 'missing', createInput, usecaseDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await deleteDocument(ctx, 'missing', usecaseDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await requestFileUpload(ctx, 'missing', { fileName: 'x', contentType: 'x', role: 'other' }, usecaseDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await removeFile(ctx, 'doc-1', 'missing', usecaseDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });

    storage.storage.createUploadUrl = async () => err(internal('target failed'));
    expect(await requestFileUpload(ctx, 'doc-1', { fileName: 'x', contentType: 'x', role: 'other' }, usecaseDeps)).toEqual(err(internal('target failed')));
    storage.storage.createUploadUrl = async () => ok(null);
    storage.storage.put = async () => err(internal('put failed'));
    expect(await serverUpload(ctx, 'doc-1', { fileName: 'x', contentType: 'x', role: 'other', bytes: new Uint8Array([1]) }, usecaseDeps)).toEqual(err(internal('put failed')));
  });

  it('cleans up a server upload when finalization fails and propagates removal failures', async () => {
    const ctx = { identity: identity('t-default') };
    const repository = fakeRepository([document('doc-1')]);
    const storage = fakeStorage();
    repository.repo.createFile = async () => err(internal('insert failed'));
    const uploadDeps = deps(repository.repo, storage.storage, ['storage-id']);
    expect(await serverUpload(ctx, 'doc-1', { fileName: 'x', contentType: 'x', role: 'other', bytes: new Uint8Array([1]) }, uploadDeps)).toEqual(err(internal('insert failed')));
    expect(storage.objects.size).toBe(0);

    repository.files.push({
      id: 'file-1',
      documentId: 'doc-1',
      role: 'other',
      fileName: 'x',
      contentType: 'x',
      sizeBytes: 1,
      storageKey: 'key',
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    storage.storage.delete = async () => err(internal('delete failed'));
    expect(await removeFile(ctx, 'doc-1', 'file-1', uploadDeps)).toEqual(err(internal('delete failed')));
  });

  it('propagates repository failures and deletion races', async () => {
    const ctx = { identity: identity('t-default') };
    const repository = fakeRepository([document('doc-1')]);
    const storage = fakeStorage();
    const usecaseDeps = deps(repository.repo, storage.storage);

    repository.repo.listFiles = async () => err(internal('list files failed'));
    expect(await getDocument(ctx, 'doc-1', usecaseDeps)).toEqual(err(internal('list files failed')));
    expect(await deleteDocument(ctx, 'doc-1', usecaseDeps)).toEqual(err(internal('list files failed')));

    repository.repo.listFiles = async () => ok([]);
    repository.repo.delete = async () => ok(false);
    expect(await deleteDocument(ctx, 'doc-1', usecaseDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });

    repository.repo.findFile = async () => err(internal('find file failed'));
    expect(await removeFile(ctx, 'doc-1', 'file-1', usecaseDeps)).toEqual(err(internal('find file failed')));
    repository.repo.findFile = async () => ok({
      id: 'file-1',
      documentId: 'doc-1',
      role: 'other',
      fileName: 'x',
      contentType: 'x',
      sizeBytes: 1,
      storageKey: 'key',
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    repository.repo.deleteFile = async () => err(internal('delete row failed'));
    expect(await removeFile(ctx, 'doc-1', 'file-1', usecaseDeps)).toEqual(err(internal('delete row failed')));
    repository.repo.deleteFile = async () => ok(false);
    expect(await removeFile(ctx, 'doc-1', 'file-1', usecaseDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
