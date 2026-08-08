import { Zip, ZipPassThrough } from 'fflate';

import type { Document, DocumentFile } from '#core/domain/index.js';
import type { ExportDocumentContent } from '#core/server/index.js';

import { cleanExportBytes } from './clean-export.js';

const safeAscii = (value: string, fallback: string): string => {
  const safe = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || fallback;
};

const fileParts = (
  fileName: string,
  contentType: string,
): { base: string; extension: string } => {
  const lastDot = fileName.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot < fileName.length - 1;
  const base = hasExtension ? fileName.slice(0, lastDot) : fileName;
  const extension = hasExtension
    ? fileName.slice(lastDot + 1)
    : contentType.trim().toLowerCase() === 'application/pdf'
      ? 'pdf'
      : 'bin';
  return { base: safeAscii(base, 'plik'), extension: safeAscii(extension, 'bin') };
};

export const singleExportFileName = (document: Document, file: DocumentFile): string => {
  const { extension } = fileParts(file.fileName, file.contentType);
  return `${document.documentDate}--${safeAscii(document.title, 'dokument')}--${file.role}.${extension}`;
};

interface ArchiveEntry {
  name: string;
  bytes: Uint8Array;
}

export const archiveEntries = async (
  documents: ExportDocumentContent[],
): Promise<ArchiveEntry[]> => {
  const entries: ArchiveEntry[] = [];
  const usedNames = new Map<string, number>();
  for (const exported of documents) {
    const directory = `${exported.document.documentDate}--${safeAscii(exported.document.title, 'dokument')}`;
    for (const { file, bytes } of exported.files) {
      const { base, extension } = fileParts(file.fileName, file.contentType);
      const plainName = `${directory}/${file.role}--${base}.${extension}`;
      const count = usedNames.get(plainName) ?? 0;
      usedNames.set(plainName, count + 1);
      const name =
        count === 0
          ? plainName
          : `${directory}/${file.role}--${base}--${count + 1}.${extension}`;
      entries.push({ name, bytes: await cleanExportBytes(bytes, file.contentType) });
    }
  }
  return entries;
};

export const zipResponseStream = (entries: ArchiveEntry[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      let failed = false;
      const zip = new Zip((error, chunk, final) => {
        if (failed) return;
        if (error) {
          failed = true;
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      for (const entry of entries) {
        const file = new ZipPassThrough(entry.name);
        file.mtime = new Date('1980-01-01T00:00:00.000Z');
        zip.add(file);
        file.push(entry.bytes, true);
      }
      zip.end();
    },
  });
