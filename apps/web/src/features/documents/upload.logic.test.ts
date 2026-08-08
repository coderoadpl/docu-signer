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
      finalize: vi.fn(async () => undefined),
      server: vi.fn(async () => undefined),
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
      finalize: vi.fn(async () => undefined),
      server: vi.fn(async () => undefined),
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
      finalize: vi.fn(async () => undefined),
      server: vi.fn(async () => undefined),
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
