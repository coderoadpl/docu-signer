import { degrees, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { flattenSignedPdf } from './signing-pdf.js';

describe('PDF signature flattening', () => {
  it('writes vector ink to the selected rotated page without adding metadata', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([300, 500]);
    const target = source.addPage([300, 500]);
    target.setRotation(degrees(90));
    const sourceBytes = await source.save();

    const signedBytes = await flattenSignedPdf(
      sourceBytes,
      1,
      [
        {
          points: [
            { x: 0.2, y: 0.3, pressure: 0.4 },
            { x: 0.5, y: 0.6, pressure: 0.8 },
          ],
        },
      ],
      { offsetX: 0.1, offsetY: 0, scale: 0.75 },
      {
        cssWidth: 500,
        cssHeight: 300,
        backingWidth: 1000,
        backingHeight: 600,
        devicePixelRatio: 2,
        viewportTransform: [0, 1, 1, 0, 0, 0],
      },
    );

    expect(signedBytes.byteLength).toBeGreaterThan(sourceBytes.byteLength);
    expect(Array.from(signedBytes.slice(0, 4))).toEqual([37, 80, 68, 70]);
    const signed = await PDFDocument.load(signedBytes, { updateMetadata: false });
    expect(signed.getPageCount()).toBe(2);
    expect(signed.getProducer()).toBeUndefined();
    expect(signed.getModificationDate()).toBeUndefined();
  });
});
