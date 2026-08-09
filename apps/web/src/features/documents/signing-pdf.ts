import type { PDFDocumentProxy } from 'pdfjs-dist';
import { z } from 'zod';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import {
  inkToPdfSegments,
  type CanvasPdfMetrics,
  type SigningStamp,
} from './core/signing.js';

const viewportTransformSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

export interface LoadedSourcePdf {
  document: PDFDocumentProxy;
  numPages: number;
  destroy(): Promise<void>;
}

export interface SigningStampWithMetrics {
  stamp: SigningStamp;
  metrics: CanvasPdfMetrics;
}

export const loadSourcePdf = async (bytes: Uint8Array): Promise<LoadedSourcePdf> => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loading.promise;
  return {
    document,
    numPages: document.numPages,
    destroy: () => loading.destroy(),
  };
};

export const sourcePageMetrics = async (
  pdf: LoadedSourcePdf,
  pageNumber: number,
): Promise<CanvasPdfMetrics> => {
  const page = await pdf.document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);
  return {
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    backingWidth: Math.max(1, Math.floor(viewport.width * devicePixelRatio)),
    backingHeight: Math.max(1, Math.floor(viewport.height * devicePixelRatio)),
    devicePixelRatio,
    viewportTransform: viewportTransformSchema.parse(viewport.transform),
  };
};

export const renderSourcePage = async (
  pdf: LoadedSourcePdf,
  pageNumber: number,
  canvas: HTMLCanvasElement,
): Promise<CanvasPdfMetrics> => {
  const page = await pdf.document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);
  const metrics = {
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    backingWidth: Math.max(1, Math.floor(viewport.width * devicePixelRatio)),
    backingHeight: Math.max(1, Math.floor(viewport.height * devicePixelRatio)),
    devicePixelRatio,
    viewportTransform: viewportTransformSchema.parse(viewport.transform),
  };
  canvas.width = metrics.backingWidth;
  canvas.height = metrics.backingHeight;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({
    canvas,
    viewport,
    transform:
      devicePixelRatio === 1
        ? undefined
        : [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
  }).promise;
  return metrics;
};

export const flattenSignedPdf = async (
  sourceBytes: Uint8Array,
  stamps: readonly SigningStampWithMetrics[],
): Promise<Uint8Array> => {
  const { LineCapStyle, PDFDocument, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  for (const { stamp, metrics } of stamps) {
    const page = pdf.getPage(stamp.pageIndex);
    for (const segment of inkToPdfSegments(
      stamp.strokes,
      stamp.placement,
      metrics,
    )) {
      page.drawSvgPath(segment.path, {
        x: 0,
        y: 0,
        borderColor: rgb(
          stamp.inkColor.pdfColor.red,
          stamp.inkColor.pdfColor.green,
          stamp.inkColor.pdfColor.blue,
        ),
        borderWidth: segment.width,
        borderLineCap: LineCapStyle.Round,
      });
    }
  }
  return pdf.save();
};
