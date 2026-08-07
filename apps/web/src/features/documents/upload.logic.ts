import type {
  DocumentFileRole,
  FileUploadRequest,
  FinalizeFileUpload,
} from '#core/domain/index.js';

interface UploadFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface UploadRequestResult {
  upload:
    | {
        kind: 'direct';
        key: string;
        target: { url: string; method: 'PUT'; headers: Record<string, string> };
      }
    | { kind: 'server'; key: string };
}

export interface UploadTransport {
  request(input: FileUploadRequest): Promise<UploadRequestResult>;
  direct(input: {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    bytes: Uint8Array;
  }): Promise<void>;
  finalize(input: FinalizeFileUpload): Promise<unknown>;
  server(input: FileUploadRequest & { bytes: Uint8Array }): Promise<unknown>;
}

export const isAcceptedDocumentFile = (file: Pick<UploadFile, 'type'>): boolean =>
  file.type === 'application/pdf' || file.type.startsWith('image/');

export const uploadDocumentFile = async (
  file: UploadFile,
  role: DocumentFileRole,
  transport: UploadTransport,
): Promise<void> => {
  if (!isAcceptedDocumentFile(file)) throw new Error('Dozwolone są pliki PDF i obrazy.');
  const contentType = file.type || 'application/octet-stream';
  const request = { fileName: file.name, contentType, role };
  const requested = await transport.request(request);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (requested.upload.kind === 'server') {
    await transport.server({ ...request, bytes });
    return;
  }
  await transport.direct({ ...requested.upload.target, bytes });
  await transport.finalize({
    key: requested.upload.key,
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    role,
  });
};
