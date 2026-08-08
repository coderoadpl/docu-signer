import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { cleanExportBytes, stripPdfMetadata } from './clean-export.js';

const metadataFixture = async (): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.setTitle('Sensitive title');
  pdf.setAuthor('Sensitive author');
  pdf.setSubject('Sensitive subject');
  pdf.setKeywords(['sensitive']);
  pdf.setProducer('Sensitive producer');
  pdf.setCreator('Sensitive creator');
  pdf.setCreationDate(new Date('2024-01-02T03:04:05.000Z'));
  pdf.setModificationDate(new Date('2025-06-07T08:09:10.000Z'));
  const xmp = pdf.context.stream(
    '<?xpacket begin="﻿"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><xmp:CreateDate>2024-01-02T03:04:05Z</xmp:CreateDate></x:xmpmeta><?xpacket end="w"?>',
    { Type: 'Metadata', Subtype: 'XML' },
  );
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(xmp));
  return pdf.save();
};

describe('clean export bytes', () => {
  it('removes the PDF Info dictionary and XMP metadata reference', async () => {
    const fixture = await metadataFixture();
    const source = await PDFDocument.load(fixture, { updateMetadata: false });
    expect(source.getTitle()).toBe('Sensitive title');
    expect(source.getCreationDate()).toEqual(new Date('2024-01-02T03:04:05.000Z'));
    expect(source.catalog.get(PDFName.of('Metadata'))).toBeDefined();

    const stripped = await stripPdfMetadata(fixture);
    const parsed = await PDFDocument.load(stripped, { updateMetadata: false });

    expect(parsed.context.trailerInfo.Info).toBeUndefined();
    expect(parsed.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(parsed.getTitle()).toBeUndefined();
    expect(parsed.getAuthor()).toBeUndefined();
    expect(parsed.getProducer()).toBeUndefined();
    expect(parsed.getCreator()).toBeUndefined();
    expect(parsed.getCreationDate()).toBeUndefined();
    expect(parsed.getModificationDate()).toBeUndefined();
    expect(new TextDecoder().decode(stripped)).not.toContain('2024-01-02T03:04:05Z');
  });

  it('passes image bytes through unchanged', async () => {
    const image = new Uint8Array([1, 2, 3]);
    await expect(cleanExportBytes(image, 'image/jpeg')).resolves.toBe(image);
  });
});
