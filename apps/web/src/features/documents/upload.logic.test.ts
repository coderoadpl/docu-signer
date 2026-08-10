import { describe, expect, it, vi } from 'vitest';

import {
  uploadDocumentFile,
  type UploadTransport,
} from './upload.logic.js';

const file = {
  name: 'umowa.pdf',
  type: 'application/pdf',
  size: 3,
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
};

const uploadedFile = {
  id: '11111111-1111-4111-8111-111111111111',
  documentId: '22222222-2222-4222-8222-222222222222',
  role: 'source' as const,
  fileName: 'umowa.pdf',
  contentType: 'application/pdf',
  sizeBytes: 3,
  storageKey: 'documents/t/d/f',
  createdAt: '2026-08-07T10:00:00.000Z',
};

describe('uploadDocumentFile', () => {
  it('uploads directly and finalizes the storage key', async () => {
    const transport: UploadTransport = {
      request: vi.fn(async () => ({
        upload: {
          kind: 'direct' as const,
          key: 'documents/t/d/f',
          target: {
            url: 'https://upload.example',
            method: 'PUT' as const,
            headers: { token: 'x' },
          },
        },
      })),
      direct: vi.fn(async () => undefined),
      finalize: vi.fn(async () => ({ file: uploadedFile })),
      server: vi.fn(async () => ({ file: uploadedFile })),
    };

    await uploadDocumentFile(file, 'source', transport);

    expect(transport.direct).toHaveBeenCalledWith({
      url: 'https://upload.example',
      method: 'PUT',
      headers: { token: 'x' },
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(transport.finalize).toHaveBeenCalledWith({
      key: 'documents/t/d/f',
      fileName: 'umowa.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      role: 'source',
    });
    expect(transport.server).not.toHaveBeenCalled();
  });

  it('uses the server fallback without finalizing separately', async () => {
    const transport: UploadTransport = {
      request: vi.fn(async () => ({
        upload: { kind: 'server' as const, key: 'documents/t/d/f' },
      })),
      direct: vi.fn(async () => undefined),
      finalize: vi.fn(async () => ({ file: uploadedFile })),
      server: vi.fn(async () => ({ file: { ...uploadedFile, role: 'signed-scan' as const } })),
    };

    await uploadDocumentFile(file, 'signed-scan', transport);

    expect(transport.server).toHaveBeenCalledWith({
      fileName: 'umowa.pdf',
      contentType: 'application/pdf',
      role: 'signed-scan',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(transport.direct).not.toHaveBeenCalled();
    expect(transport.finalize).not.toHaveBeenCalled();
  });

  it('rejects unsupported files before requesting an upload', async () => {
    const request = vi.fn();
    const transport: UploadTransport = {
      request,
      direct: vi.fn(async () => undefined),
      finalize: vi.fn(async () => ({ file: uploadedFile })),
      server: vi.fn(async () => ({ file: uploadedFile })),
    };
    await expect(
      uploadDocumentFile(
        { ...file, name: 'notes.txt', type: 'text/plain' },
        'other',
        transport,
      ),
    ).rejects.toThrow('Dozwolone są pliki PDF i obrazy.');
    expect(request).not.toHaveBeenCalled();
  });
});
