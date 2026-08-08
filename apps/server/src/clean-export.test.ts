import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { cleanExportBytes, stripPdfMetadata } from './clean-export.js';

const metadataFixture = async (): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.setTitle('Sensitive title');
  pdf.setAuthor('Sensitive author');
  pdf.setCreationDate(new Date('2024-01-02T03:04:05.000Z'));
  const xmp = pdf.context.stream(
    '<?xpacket begin="﻿"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><xmp:CreateDate>2024-01-02T03:04:05Z</xmp:CreateDate></x:xmpmeta><?xpacket end="w"?>',
    { Type: 'Metadata', Subtype: 'XML' },
  );
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(xmp));
  return pdf.save();
};

describe('clean export bytes', () => {
  it('removes PDF Info and XMP metadata', async () => {
    const stripped = await stripPdfMetadata(await metadataFixture());
    const parsed = await PDFDocument.load(stripped, { updateMetadata: false });
    expect(parsed.context.trailerInfo.Info).toBeUndefined();
    expect(parsed.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(parsed.getTitle()).toBeUndefined();
    expect(parsed.getAuthor()).toBeUndefined();
    expect(parsed.getCreationDate()).toBeUndefined();
    expect(new TextDecoder().decode(stripped)).not.toContain('2024-01-02T03:04:05Z');
  });

  it('passes non-PDF bytes through unchanged', async () => {
    const image = new Uint8Array([1, 2, 3]);
    await expect(cleanExportBytes(image, 'image/jpeg')).resolves.toBe(image);
  });

  it('recognizes a normalized PDF content type', async () => {
    const cleaned = await cleanExportBytes(await metadataFixture(), ' Application/PDF ');
    const parsed = await PDFDocument.load(cleaned, { updateMetadata: false });
    expect(parsed.context.trailerInfo.Info).toBeUndefined();
  });
});
