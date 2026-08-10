import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { SignatureRecord } from '#core/domain/index.js';

import {
  replaySignatureRecordsPdf,
  signatureInkToPdfPaths,
} from './source-update-replay.js';

const stamp = (pageIndex: number, inkColor: 'black' | 'navy' = 'black') => ({
  strokes: [
    {
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5 },
        { x: 0.2, y: 0.3, pressure: 0.7 },
        { x: 0.3, y: 0.25, pressure: 0.6 },
      ],
      simulatePressure: false,
    },
  ],
  pageIndex,
  placement: { offsetX: 0.1, offsetY: 0.2, scale: 1.2 },
  inkColor,
  inkSize: 2,
});

const record = (payload: SignatureRecord['payload']): SignatureRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-default',
  documentId: '22222222-2222-4222-8222-222222222222',
  fileId: '33333333-3333-4333-8333-333333333333',
  signedBy: 'user-owner',
  payload,
  createdAt: '2026-08-08T10:00:00.000Z',
});

describe('source update signature replay', () => {
  it('replays stored raw points on unrotated and rotated PDF pages', async () => {
    const pdf = await PDFDocument.create();
    for (const rotation of [0, 90, 180, 270]) {
      const page = pdf.addPage([400, 600]);
      page.setRotation(degrees(rotation));
    }
    const source = await pdf.save();
    const output = await replaySignatureRecordsPdf(
      source,
      [record([stamp(0), stamp(1, 'navy'), stamp(2), stamp(3, 'navy')])],
    );
    expect(output.byteLength).toBeGreaterThan(source.byteLength);
    await expect(PDFDocument.load(output)).resolves.toBeDefined();
  });

  it('rejects a replacement with fewer pages than the stored placement', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]);
    await expect(
      replaySignatureRecordsPdf(await pdf.save(), [record([stamp(1)])]),
    ).rejects.toThrow('too few pages');
  });

  it('returns no paths for empty strokes and refuses singular transforms', () => {
    const metrics = {
      cssWidth: 100,
      cssHeight: 100,
      backingWidth: 100,
      backingHeight: 100,
      devicePixelRatio: 1,
      viewportTransform: [1, 0, 0, -1, 0, 100] as const,
    };
    expect(
      signatureInkToPdfPaths(
        { ...stamp(0), strokes: [] },
        metrics,
      ),
    ).toEqual([]);
    expect(() =>
      signatureInkToPdfPaths(stamp(0), {
        ...metrics,
        viewportTransform: [0, 0, 0, 0, 0, 0],
      }),
    ).toThrow('not invertible');
  });
});
