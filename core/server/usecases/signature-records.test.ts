import { describe, expect, it, vi } from 'vitest';

import { signatureRecordPayloadSchema } from '#core/domain/index.js';
import type {
  ApiTokenScope,
  Document,
  DocumentFile,
  Identity,
  SignatureRecord,
  SignatureRecordCursor,
} from '#core/domain/index.js';
import type {
  DocumentRepository,
  SignatureRecordRepository,
} from '../ports.js';
import {
  createSignatureRecord,
  listSignatureRecords,
} from './signature-records.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const otherDocumentId = '44444444-4444-4444-8444-444444444444';
const fileId = '22222222-2222-4222-8222-222222222222';
const otherFileId = '55555555-5555-4555-8555-555555555555';
const recordId = '33333333-3333-4333-8333-333333333333';
const otherRecordId = '66666666-6666-4666-8666-666666666666';
const legacyPayload = [
  {
    strokes: [
      {
        points: [{ x: 0.1, y: 0.2, pressure: 0.7 }],
        simulatePressure: false,
      },
    ],
    pageIndex: 0,
    placement: { offsetX: 0.2, offsetY: 0.3, scale: 1.1 },
    inkColor: 'navy' as const,
    inkSize: 2,
  },
];

const payload = legacyPayload.map((stamp) => ({
  ...stamp,
  contributedBy: 'user-1',
}));

const identity = (scopes: readonly ApiTokenScope[] | null = null): Identity => ({
  userId: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
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
  documentDate: '2026-08-07',
  periodStart: null,
  periodEnd: null,
  person: null,
  tags: [],
  draft: false,
  createdAt: '2026-08-07T10:00:00.000Z',
  updatedAt: '2026-08-07T10:00:00.000Z',
  deletedAt: null,
};

const file: DocumentFile = {
  id: fileId,
  documentId,
  role: 'signed-digital',
  fileName: 'umowa-podpisana.pdf',
  contentType: 'application/pdf',
  sizeBytes: 100,
  storageKey: 'documents/tenant-1/document/file',
  createdAt: '2026-08-07T10:00:00.000Z',
};

const documents = (): DocumentRepository => ({
  listByTenant: async () => [],
  listDeletedByTenant: async () => [],
  findById: async (tenantId, id) => tenantId === document.tenantId && id === document.id ? document : null,
  findDeletedById: async () => null,
  findAnyById: async () => document,
  listFiles: async () => [file],
  listFilesIncludingDeleted: async () => [file],
  listAllFilesIncludingDeleted: async () => [file],
  listFilesForDocuments: async () => [file],
  create: async () => document,
  update: async () => document,
  approve: async () => document,
  delete: async () => true,
  restore: async () => document,
  purge: async () => true,
  createFile: async () => file,
  updateFileSize: async () => true,
  findFile: async (tenantId, id, candidateFileId) =>
    tenantId === document.tenantId && id === document.id && candidateFileId === file.id
      ? file
      : null,
  moveFileToDocument: async () => file,
  deleteFile: async () => true,
});

const records = (): SignatureRecordRepository => {
  const values: SignatureRecord[] = [];
  return {
    listByDocument: async (tenantId, id, _cursor, limit) =>
      values
        .filter((record) => record.tenantId === tenantId && record.documentId === id)
        .slice(0, limit),
    create: async (input) => {
      if (values.some((record) => record.fileId === input.fileId)) return null;
      const record = { ...input, createdAt: '2026-08-07T10:00:00.000Z' };
      values.push(record);
      return record;
    },
    recordSeal: async () => {},
  };
};

describe('signature record use-cases', () => {
  it('parses legacy stamps without contributors and contributor-aware stamps', () => {
    expect(signatureRecordPayloadSchema.parse(legacyPayload)).toEqual(legacyPayload);
    expect(signatureRecordPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('creates and lists write-once records for signed-digital files', async () => {
    const deps = {
      documents: documents(),
      signatureRecords: records(),
      ids: { nextId: () => recordId },
    };
    const ctx = { identity: identity() };

    await expect(
      createSignatureRecord(ctx, documentId, { fileId, payload }, deps),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: recordId,
        tenantId: 'tenant-1',
        documentId,
        fileId,
        signedBy: 'user-1',
        payload,
      },
    });
    await expect(
      listSignatureRecords(ctx, documentId, { limit: 1 }, deps),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: recordId }], nextCursor: null },
    });
    await expect(
      createSignatureRecord(ctx, documentId, { fileId, payload }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('rejects malformed ids, pagination and cursors', async () => {
    const deps = {
      documents: documents(),
      signatureRecords: records(),
      ids: { nextId: () => recordId },
    };
    const ctx = { identity: identity() };

    await expect(
      listSignatureRecords(ctx, 'not-a-uuid', {}, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listSignatureRecords(ctx, documentId, { limit: 0 }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listSignatureRecords(ctx, documentId, { cursor: 'nonsense' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      listSignatureRecords(ctx, otherDocumentId, {}, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(
      createSignatureRecord(ctx, 'not-a-uuid', { fileId, payload }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      createSignatureRecord(ctx, documentId, { fileId, payload: [] }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      createSignatureRecord(ctx, documentId, { fileId: otherFileId, payload }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects a file that is not the signed-digital output', async () => {
    const documentRepository = documents();
    documentRepository.findFile = async () => ({ ...file, role: 'source' });
    const deps = {
      documents: documentRepository,
      signatureRecords: records(),
      ids: { nextId: () => recordId },
    };

    await expect(
      createSignatureRecord({ identity: identity() }, documentId, { fileId, payload }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('pages records with an opaque cursor', async () => {
    const stored: SignatureRecord[] = [
      {
        id: recordId,
        tenantId: 'tenant-1',
        documentId,
        fileId,
        signedBy: 'user-1',
        payload,
        createdAt: '2026-08-07T11:00:00.000Z',
      },
      {
        id: otherRecordId,
        tenantId: 'tenant-1',
        documentId,
        fileId: otherFileId,
        signedBy: 'user-1',
        payload,
        createdAt: '2026-08-07T10:00:00.000Z',
      },
    ];
    const seen: (SignatureRecordCursor | null)[] = [];
    const deps = {
      documents: documents(),
      signatureRecords: {
        listByDocument: async (_tenantId, _id, cursor, limit) => {
          seen.push(cursor);
          const start = cursor ? stored.findIndex((row) => row.id === cursor.id) + 1 : 0;
          return stored.slice(start, start + limit);
        },
        create: async () => null,
        recordSeal: async () => {},
      } satisfies SignatureRecordRepository,
    };
    const ctx = { identity: identity() };

    const firstPage = await listSignatureRecords(ctx, documentId, { limit: 1 }, deps);
    expect(firstPage).toMatchObject({ ok: true, value: { items: [{ id: recordId }] } });
    const nextCursor = firstPage.ok ? firstPage.value.nextCursor : null;
    expect(nextCursor).toEqual(expect.any(String));

    await expect(
      listSignatureRecords(ctx, documentId, { limit: 1, cursor: nextCursor }, deps),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: otherRecordId }], nextCursor: null },
    });
    expect(seen).toEqual([null, { createdAt: '2026-08-07T11:00:00.000Z', id: recordId }]);
  });

  it('denies read and write:draft tokens before any repository access', async () => {
    for (const scopes of [['read'], ['write:draft']] as const) {
      const documentRepository = documents();
      const signatureRecords = records();
      const documentFind = vi.spyOn(documentRepository, 'findById');
      const fileFind = vi.spyOn(documentRepository, 'findFile');
      const list = vi.spyOn(signatureRecords, 'listByDocument');
      const create = vi.spyOn(signatureRecords, 'create');
      const deps = {
        documents: documentRepository,
        signatureRecords,
        ids: { nextId: () => recordId },
      };
      const ctx = { identity: identity(scopes) };

      await expect(
        listSignatureRecords(ctx, documentId, {}, deps),
      ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
      await expect(
        createSignatureRecord(ctx, documentId, { fileId, payload }, deps),
      ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(documentFind).not.toHaveBeenCalled();
      expect(fileFind).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  });
});
