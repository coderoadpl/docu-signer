export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
}

interface PointerInkSample {
  clientX: number;
  clientY: number;
  pressure: number;
}

export interface PointerInkEvent extends PointerInkSample {
  getCoalescedEvents?: () => readonly PointerInkSample[];
}

export interface InkStroke {
  points: InkPoint[];
}

export interface SignaturePlacement {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface SigningStamp {
  pageIndex: number;
  strokes: InkStroke[];
  inkColor: SigningInkColor;
  placement: SignaturePlacement;
}

export interface CanvasPdfMetrics {
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  devicePixelRatio: number;
  viewportTransform: readonly [number, number, number, number, number, number];
}

export interface PdfInkSegment {
  path: string;
  width: number;
}

export type SigningGestureMode = 'draw' | 'pan';

export type SigningInkColorId = 'black' | 'navy';

export interface SigningInkColor {
  id: SigningInkColorId;
  label: string;
  canvasColor: string;
  pdfColor: {
    red: number;
    green: number;
    blue: number;
  };
}

export const SIGNING_INK_COLORS: readonly [SigningInkColor, SigningInkColor] = [
  {
    id: 'black',
    label: 'Czarny',
    canvasColor: '#0a0a0a',
    pdfColor: { red: 0.04, green: 0.04, blue: 0.04 },
  },
  {
    id: 'navy',
    label: 'Granatowy',
    canvasColor: '#2244aa',
    pdfColor: { red: 0.13, green: 0.27, blue: 0.67 },
  },
];

export const DEFAULT_SIGNING_INK_COLOR = SIGNING_INK_COLORS[0];

export const signingInkColorById = (id: SigningInkColorId): SigningInkColor =>
  SIGNING_INK_COLORS.find((color) => color.id === id) ?? DEFAULT_SIGNING_INK_COLOR;

export interface SmoothedSegment {
  start: InkPoint;
  control: InkPoint;
  end: InkPoint;
}

const SIGNING_PEN_PRIORITY_MS = 500;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const midpoint = (first: InkPoint, second: InkPoint): InkPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
  pressure: (first.pressure + second.pressure) / 2,
});

const cloneStrokes = (strokes: InkStroke[]): InkStroke[] =>
  strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({ ...point })),
  }));

export const pointerToInkPoint = (
  clientX: number,
  clientY: number,
  pressure: number,
  bounds: { left: number; top: number; width: number; height: number },
): InkPoint => {
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Ink surface must have positive dimensions');
  }
  return {
    x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
    y: clamp((clientY - bounds.top) / bounds.height, 0, 1),
    pressure: pressure > 0 ? clamp(pressure, 0.1, 1) : 0.5,
  };
};

export const pointerEventToInkPoints = (
  event: PointerInkEvent,
  bounds: { left: number; top: number; width: number; height: number },
): InkPoint[] => {
  const coalesced = event.getCoalescedEvents?.() ?? [];
  const samples = coalesced.length > 0 ? coalesced : [event];
  return samples.map((sample) =>
    pointerToInkPoint(sample.clientX, sample.clientY, sample.pressure, bounds),
  );
};

export const defaultSigningGestureMode = ({
  coarsePointer,
  maxTouchPoints,
}: {
  coarsePointer: boolean;
  maxTouchPoints: number;
}): SigningGestureMode =>
  coarsePointer || maxTouchPoints > 0 ? 'pan' : 'draw';

export const isPalmSizedTouch = ({
  height,
  pointerType,
  width,
}: {
  height: number;
  pointerType: string;
  width: number;
}): boolean =>
  pointerType === 'touch' &&
  (width >= 45 || height >= 45 || width * height >= 1400);

export const penPriorityActive = ({
  activePenPointerId,
  lastPenSeenAt,
  now,
}: {
  activePenPointerId: number | undefined;
  lastPenSeenAt: number | undefined;
  now: number;
}): boolean =>
  activePenPointerId !== undefined ||
  (lastPenSeenAt !== undefined &&
    now >= lastPenSeenAt &&
    now - lastPenSeenAt <= SIGNING_PEN_PRIORITY_MS);

export const documentPointerDrawsInk = ({
  fingerDrawing,
  mode,
  penPriority,
  pointer,
}: {
  fingerDrawing: boolean;
  mode: SigningGestureMode;
  penPriority: boolean;
  pointer: {
    pointerType: string;
  };
}): boolean => {
  if (mode !== 'draw') return false;
  if (pointer.pointerType === 'pen') return true;
  if (pointer.pointerType === 'touch') {
    return fingerDrawing && !penPriority;
  }
  return true;
};

export const smoothStroke = (stroke: InkStroke): SmoothedSegment[] => {
  const first = stroke.points[0];
  if (!first) return [];
  if (stroke.points.length === 1) {
    return [{ start: first, control: first, end: first }];
  }

  const segments: SmoothedSegment[] = [];
  let start = first;
  for (const [index, control] of stroke.points.slice(1).entries()) {
    const next = stroke.points[index + 2];
    const end = next ? midpoint(control, next) : control;
    segments.push({ start, control, end });
    start = end;
  }
  return segments;
};

const inkBounds = (strokes: InkStroke[]) => {
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

export const placedInkBounds = (
  strokes: InkStroke[],
  placement: SignaturePlacement,
) => {
  const bounds = inkBounds(strokes);
  if (!bounds) return undefined;
  const corners = [
    { x: bounds.left, y: bounds.top, pressure: 0.5 },
    { x: bounds.right, y: bounds.top, pressure: 0.5 },
    { x: bounds.right, y: bounds.bottom, pressure: 0.5 },
    { x: bounds.left, y: bounds.bottom, pressure: 0.5 },
  ].map((point) => placeInkPoint(point, strokes, placement));
  const first = corners[0];
  if (!first) return undefined;
  return corners.slice(1).reduce(
    (current, point) => ({
      left: Math.min(current.left, point.x),
      right: Math.max(current.right, point.x),
      top: Math.min(current.top, point.y),
      bottom: Math.max(current.bottom, point.y),
    }),
    {
      left: first.x,
      right: first.x,
      top: first.y,
      bottom: first.y,
    },
  );
};

export const placeInkPoint = (
  point: InkPoint,
  strokes: InkStroke[],
  placement: SignaturePlacement,
): InkPoint => {
  const bounds = inkBounds(strokes);
  if (!bounds) return point;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return {
    ...point,
    x: centerX + (point.x - centerX) * placement.scale + placement.offsetX,
    y: centerY + (point.y - centerY) * placement.scale + placement.offsetY,
  };
};

export const createSigningStamp = ({
  pageIndex,
  strokes,
  inkColor,
  placement,
}: SigningStamp): SigningStamp => ({
  pageIndex,
  strokes: cloneStrokes(strokes),
  inkColor,
  placement: { ...placement },
});

export const centeredInkPlacement = (
  strokes: InkStroke[],
  scale = 1,
): SignaturePlacement => {
  const bounds = inkBounds(strokes);
  if (!bounds) return { offsetX: 0, offsetY: 0, scale };
  return {
    offsetX: 0.5 - (bounds.left + bounds.right) / 2,
    offsetY: 0.5 - (bounds.top + bounds.bottom) / 2,
    scale,
  };
};

export const appendSigningStamp = (
  stamps: readonly SigningStamp[],
  stamp: SigningStamp,
): SigningStamp[] => [...stamps, createSigningStamp(stamp)];

export const stampEveryPage = (
  stamps: readonly SigningStamp[],
  stamp: Omit<SigningStamp, 'pageIndex'>,
  pageCount: number,
): SigningStamp[] => [
  ...stamps,
  ...Array.from({ length: Math.max(0, pageCount) }, (_, pageIndex) =>
    createSigningStamp({ ...stamp, pageIndex }),
  ),
];

export const updateSigningStampPlacement = (
  stamps: readonly SigningStamp[],
  stampIndex: number,
  placement: SignaturePlacement,
): SigningStamp[] =>
  stamps.map((stamp, index) =>
    index === stampIndex
      ? createSigningStamp({ ...stamp, placement })
      : createSigningStamp(stamp),
  );

export const removeSigningStamp = (
  stamps: readonly SigningStamp[],
  stampIndex: number,
): SigningStamp[] => stamps.filter((_, index) => index !== stampIndex);

export const signingStampsForPage = (
  stamps: readonly SigningStamp[],
  pageIndex: number,
): Array<{ stamp: SigningStamp; stampIndex: number }> =>
  stamps.flatMap((stamp, stampIndex) =>
    stamp.pageIndex === pageIndex ? [{ stamp, stampIndex }] : [],
  );

export const signingStampContainsPoint = (
  stamp: SigningStamp,
  point: Pick<InkPoint, 'x' | 'y'>,
): boolean => {
  const bounds = placedInkBounds(stamp.strokes, stamp.placement);
  if (!bounds) return false;
  const padding = 0.04;
  return (
    point.x >= bounds.left - padding &&
    point.x <= bounds.right + padding &&
    point.y >= bounds.top - padding &&
    point.y <= bounds.bottom + padding
  );
};

export const canvasCssPointToPdf = (
  point: Pick<InkPoint, 'x' | 'y'>,
  metrics: CanvasPdfMetrics,
): { x: number; y: number } => {
  if (
    metrics.cssWidth <= 0 ||
    metrics.cssHeight <= 0 ||
    metrics.backingWidth <= 0 ||
    metrics.backingHeight <= 0 ||
    metrics.devicePixelRatio <= 0
  ) {
    throw new Error('Canvas and pixel-ratio dimensions must be positive');
  }

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

  // PDF.js maps bottom-left PDF user space into a rotated, top-left canvas.
  // Inverting that exact affine matrix also absorbs CSS scaling and DPR above.
  return {
    x: (d * (viewportX - e) - c * (viewportY - f)) / determinant,
    y: (-b * (viewportX - e) + a * (viewportY - f)) / determinant,
  };
};

const cssLengthToPdf = (length: number, metrics: CanvasPdfMetrics): number => {
  const origin = canvasCssPointToPdf({ x: 0, y: 0 }, metrics);
  const end = canvasCssPointToPdf({ x: length, y: 0 }, metrics);
  return Math.hypot(end.x - origin.x, end.y - origin.y);
};

const svgNumber = (value: number): string => String(Number(value.toFixed(4)));

const segmentPath = (
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
): string => {
  const effectiveEnd =
    start.x === end.x && start.y === end.y
      ? { x: end.x + 0.01, y: end.y }
      : end;
  // pdf-lib applies the SVG convention (positive Y downward) before emitting
  // PDF operators, so PDF user-space Y values are negated in the path string.
  return `M ${svgNumber(start.x)} ${svgNumber(-start.y)} Q ${svgNumber(control.x)} ${svgNumber(-control.y)} ${svgNumber(effectiveEnd.x)} ${svgNumber(-effectiveEnd.y)}`;
};

const lineWidth = (pressure: number): number => 1.5 + clamp(pressure, 0.1, 1) * 2.5;

export const inkToPdfSegments = (
  strokes: InkStroke[],
  placement: SignaturePlacement,
  metrics: CanvasPdfMetrics,
): PdfInkSegment[] =>
  strokes.flatMap((stroke) => {
    const placedStroke = {
      points: stroke.points.map((point) => placeInkPoint(point, strokes, placement)),
    };
    return smoothStroke(placedStroke).map((segment) => {
      const start = canvasCssPointToPdf(
        {
          x: segment.start.x * metrics.cssWidth,
          y: segment.start.y * metrics.cssHeight,
        },
        metrics,
      );
      const control = canvasCssPointToPdf(
        {
          x: segment.control.x * metrics.cssWidth,
          y: segment.control.y * metrics.cssHeight,
        },
        metrics,
      );
      const end = canvasCssPointToPdf(
        {
          x: segment.end.x * metrics.cssWidth,
          y: segment.end.y * metrics.cssHeight,
        },
        metrics,
      );
      const pressure =
        (segment.start.pressure + segment.control.pressure + segment.end.pressure) / 3;
      return {
        path: segmentPath(start, control, end),
        width: cssLengthToPdf(lineWidth(pressure), metrics),
      };
    });
  });

export const signedFileName = (sourceName: string): string => {
  const stem = sourceName.replace(/\.pdf$/iu, '');
  const baseStem = stem || 'dokument';
  const signedMatch = /^(.*-podpisany)(?:-(\d+))?$/u.exec(baseStem);
  if (!signedMatch) return `${baseStem}-podpisany.pdf`;
  const signedStem = signedMatch[1] ?? baseStem;
  const currentVersion = signedMatch[2] ? Number(signedMatch[2]) : 1;
  return `${signedStem}-${currentVersion + 1}.pdf`;
};
