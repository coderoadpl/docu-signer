import { degrees, PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SIGNING_INK_COLOR, signingInkColorById } from './signing.js';
import { flattenSignedPdf } from './signing-pdf.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PDF signature flattening', () => {
  it('writes vector ink to the selected rotated page without adding metadata', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([300, 500]);
    const target = source.addPage([300, 500]);
    target.setRotation(degrees(90));
    const sourceBytes = await source.save();

    const signedBytes = await flattenSignedPdf(
      sourceBytes,
      [
        {
          stamp: {
            pageIndex: 1,
            strokes: [
              {
                points: [
                  { x: 0.2, y: 0.3, pressure: 0.4 },
                  { x: 0.5, y: 0.6, pressure: 0.8 },
                ],
              },
            ],
            placement: { offsetX: 0.1, offsetY: 0, scale: 0.75 },
            inkColor: DEFAULT_SIGNING_INK_COLOR,
          },
          metrics: {
            cssWidth: 500,
            cssHeight: 300,
            backingWidth: 1000,
            backingHeight: 600,
            devicePixelRatio: 2,
            viewportTransform: [0, 1, 1, 0, 0, 0],
          },
        },
      ],
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
      [
        {
          stamp: {
            pageIndex: 0,
            strokes: [
              {
                points: [
                  { x: 0.2, y: 0.3, pressure: 0.4 },
                  { x: 0.5, y: 0.6, pressure: 0.8 },
                ],
              },
            ],
            placement: { offsetX: 0, offsetY: 0, scale: 1 },
            inkColor,
          },
          metrics: {
            cssWidth: 300,
            cssHeight: 500,
            backingWidth: 600,
            backingHeight: 1000,
            devicePixelRatio: 2,
            viewportTransform: [1, 0, 0, -1, 0, 500],
          },
        },
      ],
    );

    expect(drawSvgPath).toHaveBeenCalled();
    expect(drawSvgPath.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        borderColor: rgb(0.13, 0.27, 0.67),
      }),
    );
  });

  it('draws multiple stamps on their own pages in one pass', async () => {
    const pageWidths: number[] = [];
    vi.spyOn(PDFPage.prototype, 'drawSvgPath').mockImplementation(function (
      this: PDFPage,
    ) {
      pageWidths.push(this.getWidth());
    });
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([200, 300]);
    source.addPage([250, 350]);
    const sourceBytes = await source.save();

    await flattenSignedPdf(sourceBytes, [
      {
        stamp: {
          pageIndex: 0,
          strokes: [
            {
              points: [
                { x: 0.2, y: 0.2, pressure: 0.5 },
                { x: 0.4, y: 0.4, pressure: 0.5 },
              ],
            },
          ],
          placement: { offsetX: 0, offsetY: 0, scale: 1 },
          inkColor: DEFAULT_SIGNING_INK_COLOR,
        },
        metrics: {
          cssWidth: 200,
          cssHeight: 300,
          backingWidth: 400,
          backingHeight: 600,
          devicePixelRatio: 2,
          viewportTransform: [1, 0, 0, -1, 0, 300],
        },
      },
      {
        stamp: {
          pageIndex: 1,
          strokes: [
            {
              points: [
                { x: 0.1, y: 0.7, pressure: 0.5 },
                { x: 0.5, y: 0.8, pressure: 0.5 },
              ],
            },
          ],
          placement: { offsetX: 0.1, offsetY: -0.1, scale: 0.8 },
          inkColor: signingInkColorById('navy'),
        },
        metrics: {
          cssWidth: 250,
          cssHeight: 350,
          backingWidth: 500,
          backingHeight: 700,
          devicePixelRatio: 2,
          viewportTransform: [1, 0, 0, -1, 0, 350],
        },
      },
    ]);

    expect(pageWidths).toEqual([200, 250]);
  });
});
