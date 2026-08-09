import { degrees, PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SIGNING_INK_COLOR, signingInkColorById } from './core/signing.js';
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
      DEFAULT_SIGNING_INK_COLOR,
    );

    expect(signedBytes.byteLength).toBeGreaterThan(sourceBytes.byteLength);
    expect(Array.from(signedBytes.slice(0, 4))).toEqual([37, 80, 68, 70]);
    const signed = await PDFDocument.load(signedBytes, { updateMetadata: false });
    expect(signed.getPageCount()).toBe(2);
    expect(signed.getProducer()).toBeUndefined();
    expect(signed.getModificationDate()).toBeUndefined();
  });

  it('passes the selected ink color to pdf-lib drawing options', async () => {
    const drawSvgPath = vi.spyOn(PDFPage.prototype, 'drawSvgPath');
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([300, 500]);
    const sourceBytes = await source.save();
    const inkColor = signingInkColorById('navy');

    await flattenSignedPdf(
      sourceBytes,
      0,
      [
        {
          points: [
            { x: 0.2, y: 0.3, pressure: 0.4 },
            { x: 0.5, y: 0.6, pressure: 0.8 },
          ],
        },
      ],
      { offsetX: 0, offsetY: 0, scale: 1 },
      {
        cssWidth: 300,
        cssHeight: 500,
        backingWidth: 600,
        backingHeight: 1000,
        devicePixelRatio: 2,
        viewportTransform: [1, 0, 0, -1, 0, 500],
      },
      inkColor,
    );

    expect(drawSvgPath).toHaveBeenCalled();
    expect(drawSvgPath.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        borderColor: rgb(
          inkColor.pdfColor.red,
          inkColor.pdfColor.green,
          inkColor.pdfColor.blue,
        ),
      }),
    );
  });
});
