import type { PDFDocumentProxy } from 'pdfjs-dist';
import { z } from 'zod';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import {
  inkToPdfSegments,
  type CanvasPdfMetrics,
  type InkStroke,
  type SignaturePlacement,
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

export const renderSourcePage = async (
  pdf: LoadedSourcePdf,
  pageNumber: number,
  canvas: HTMLCanvasElement,
): Promise<CanvasPdfMetrics> => {
  const page = await pdf.document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.max(1, Math.floor(viewport.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(viewport.height * devicePixelRatio));
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
  return {
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    backingWidth: canvas.width,
    backingHeight: canvas.height,
    devicePixelRatio,
    viewportTransform: viewportTransformSchema.parse(viewport.transform),
  };
};

export const flattenSignedPdf = async (
  sourceBytes: Uint8Array,
  pageIndex: number,
  strokes: InkStroke[],
  placement: SignaturePlacement,
  metrics: CanvasPdfMetrics,
): Promise<Uint8Array> => {
  const { LineCapStyle, PDFDocument, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const page = pdf.getPage(pageIndex);
  for (const segment of inkToPdfSegments(strokes, placement, metrics)) {
    page.drawSvgPath(segment.path, {
      x: 0,
      y: 0,
      borderColor: rgb(0.04, 0.04, 0.04),
      borderWidth: segment.width,
      borderLineCap: LineCapStyle.Round,
    });
  }
  return pdf.save();
};
