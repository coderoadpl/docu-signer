import { getStroke } from 'perfect-freehand';

import type { SignatureRecord, SignatureRecordPayload } from '#core/domain/index.js';

export interface SignatureReplayMetrics {
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  devicePixelRatio: number;
  viewportTransform: readonly [number, number, number, number, number, number];
}

interface SignatureReplayPoint {
  x: number;
  y: number;
}

export interface SignatureReplayPath {
  path: string;
  points: SignatureReplayPoint[];
}

const inkBounds = (strokes: SignatureRecordPayload[number]['strokes']) => {
  const points = strokes.flatMap((stroke) => stroke.points);
  const first = points[0];
  if (!first) return undefined;
  return points.slice(1).reduce(
    (bounds, point) => ({
      left: Math.min(bounds.left, point.x),
      right: Math.max(bounds.right, point.x),
      top: Math.min(bounds.top, point.y),
      bottom: Math.max(bounds.bottom, point.y),
    }),
    {
      left: first.x,
      right: first.x,
      top: first.y,
      bottom: first.y,
    },
  );
};

const svgNumber = (value: number): string => String(Number(value.toFixed(4)));

const average = (first: number, second: number): number => (first + second) / 2;

const outlinePointsToSvgPath = (
  points: readonly SignatureReplayPoint[],
): string => {
  const first = points[0];
  const second = points[1];
  const third = points[2];
  if (!first || !second || !third || points.length < 4) return '';
  const commands = [
    `M ${svgNumber(first.x)} ${svgNumber(first.y)}`,
    `Q ${svgNumber(second.x)} ${svgNumber(second.y)} ${svgNumber(average(second.x, third.x))} ${svgNumber(average(second.y, third.y))}`,
  ];
  for (let index = 2; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (!point || !next) continue;
    commands.push(
      `Q ${svgNumber(point.x)} ${svgNumber(point.y)} ${svgNumber(average(point.x, next.x))} ${svgNumber(average(point.y, next.y))}`,
    );
  }
  commands.push('Z');
  return commands.join(' ');
};

const canvasCssPointToPdf = (
  point: SignatureReplayPoint,
  metrics: SignatureReplayMetrics,
): SignatureReplayPoint => {
  const viewportX =
    (point.x * metrics.backingWidth) /
    metrics.cssWidth /
    metrics.devicePixelRatio;
  const viewportY =
    (point.y * metrics.backingHeight) /
    metrics.cssHeight /
    metrics.devicePixelRatio;
  const [a, b, c, d, e, f] = metrics.viewportTransform;
  const determinant = a * d - b * c;
  if (determinant === 0) throw new Error('PDF viewport transform is not invertible');
  return {
    x: (d * (viewportX - e) - c * (viewportY - f)) / determinant,
    y: (-b * (viewportX - e) + a * (viewportY - f)) / determinant,
  };
};

export const signatureInkToPdfPaths = (
  stamp: SignatureRecordPayload[number],
  metrics: SignatureReplayMetrics,
): SignatureReplayPath[] =>
  stamp.strokes.flatMap((stroke) => {
    const bounds = inkBounds(stamp.strokes);
    if (!bounds) return [];
    const centerX = ((bounds.left + bounds.right) / 2) * metrics.cssWidth;
    const centerY = ((bounds.top + bounds.bottom) / 2) * metrics.cssHeight;
    const outline = getStroke(
      stroke.points.map((point) => ({
        x: point.x * metrics.cssWidth,
        y: point.y * metrics.cssHeight,
        pressure: point.pressure,
      })),
      {
        thinning: 0.6,
        smoothing: 0.5,
        streamline: 0.5,
        last: true,
        size: Math.min(6, Math.max(1, stamp.inkSize)),
        simulatePressure: stroke.simulatePressure ?? false,
      },
    );
    const points = outline.map(([x, y]) => {
      const placed = {
        x:
          centerX +
          (x - centerX) * stamp.placement.scale +
          stamp.placement.offsetX * metrics.cssWidth,
        y:
          centerY +
          (y - centerY) * stamp.placement.scale +
          stamp.placement.offsetY * metrics.cssHeight,
      };
      const pdfPoint = canvasCssPointToPdf(placed, metrics);
      return { x: pdfPoint.x, y: -pdfPoint.y };
    });
    const path = outlinePointsToSvgPath(points);
    return path ? [{ path, points }] : [];
  });

const pageMetrics = (
  page: {
    getMediaBox(): { x: number; y: number; width: number; height: number };
    getRotation(): { angle: number };
  },
): SignatureReplayMetrics => {
  const box = page.getMediaBox();
  const scale = 1.5;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (rotation === 90) {
    return {
      cssWidth: box.height * scale,
      cssHeight: box.width * scale,
      backingWidth: box.height * scale,
      backingHeight: box.width * scale,
      devicePixelRatio: 1,
      viewportTransform: [0, scale, scale, 0, -box.y * scale, -box.x * scale],
    };
  }
  if (rotation === 180) {
    return {
      cssWidth: box.width * scale,
      cssHeight: box.height * scale,
      backingWidth: box.width * scale,
      backingHeight: box.height * scale,
      devicePixelRatio: 1,
      viewportTransform: [
        -scale,
        0,
        0,
        scale,
        (box.x + box.width) * scale,
        -box.y * scale,
      ],
    };
  }
  if (rotation === 270) {
    return {
      cssWidth: box.height * scale,
      cssHeight: box.width * scale,
      backingWidth: box.height * scale,
      backingHeight: box.width * scale,
      devicePixelRatio: 1,
      viewportTransform: [
        0,
        -scale,
        -scale,
        0,
        (box.y + box.height) * scale,
        (box.x + box.width) * scale,
      ],
    };
  }
  return {
    cssWidth: box.width * scale,
    cssHeight: box.height * scale,
    backingWidth: box.width * scale,
    backingHeight: box.height * scale,
    devicePixelRatio: 1,
    viewportTransform: [
      scale,
      0,
      0,
      -scale,
      -box.x * scale,
      (box.y + box.height) * scale,
    ],
  };
};

export const replaySignatureRecordsPdf = async (
  sourceBytes: Uint8Array,
  records: readonly SignatureRecord[],
): Promise<Uint8Array> => {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const ordered = [...records].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  for (const record of ordered) {
    for (const stamp of record.payload) {
      if (stamp.pageIndex >= pdf.getPageCount()) {
        throw new Error('Replacement source has too few pages for stored signatures');
      }
      const page = pdf.getPage(stamp.pageIndex);
      const metrics = pageMetrics(page);
      for (const outline of signatureInkToPdfPaths(stamp, metrics)) {
        const color = stamp.inkColor === 'navy'
          ? { red: 0.13, green: 0.27, blue: 0.67 }
          : { red: 0.04, green: 0.04, blue: 0.04 };
        page.drawSvgPath(outline.path, {
          x: 0,
          y: 0,
          color: rgb(color.red, color.green, color.blue),
        });
      }
    }
  }
  return pdf.save();
};
