import { z } from 'zod';

// Safari/WebKit lacks Map.getOrInsertComputed, which pdf.js' modern build uses.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import {
  inkToPdfPaths,
  type CanvasPdfMetrics,
  type SigningStamp,
} from './signing.js';

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
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
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
  fitBox?: { width: number; height: number },
): Promise<CanvasPdfMetrics> => {
  const page = await pdf.document.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const fitScale =
    fitBox && fitBox.width > 0 && fitBox.height > 0
      ? Math.min(fitBox.width / baseViewport.width, fitBox.height / baseViewport.height)
      : undefined;
  const viewport = page.getViewport({ scale: fitScale ?? 1.5 });
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
  const { PDFDocument, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  for (const { stamp, metrics } of stamps) {
    const page = pdf.getPage(stamp.pageIndex);
    for (const outline of inkToPdfPaths(
      stamp.strokes,
      stamp.placement,
      metrics,
    )) {
      page.drawSvgPath(outline.path, {
        x: 0,
        y: 0,
        color: rgb(
          stamp.inkColor.pdfColor.red,
          stamp.inkColor.pdfColor.green,
          stamp.inkColor.pdfColor.blue,
        ),
      });
    }
  }
  return pdf.save();
};
