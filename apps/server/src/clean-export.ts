import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';

const removeReferencedObject = (
  pdf: PDFDocument,
  object: ReturnType<PDFDocument['catalog']['get']>,
): void => {
  if (object instanceof PDFRef) pdf.context.delete(object);
};

export const stripPdfMetadata = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const metadata = pdf.catalog.get(PDFName.of('Metadata'));
  removeReferencedObject(pdf, metadata);
  pdf.catalog.delete(PDFName.of('Metadata'));
  const info = pdf.context.trailerInfo.Info;
  if (info instanceof PDFRef) pdf.context.delete(info);
  delete pdf.context.trailerInfo.Info;
  return pdf.save({ useObjectStreams: false });
};

export const cleanExportBytes = (
  bytes: Uint8Array,
  contentType: string,
): Promise<Uint8Array> =>
  contentType.trim().toLowerCase() === 'application/pdf'
    ? stripPdfMetadata(bytes)
    : Promise.resolve(bytes);
