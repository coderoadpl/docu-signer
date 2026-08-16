import { getStroke, type StrokeOptions } from 'perfect-freehand';

import { signatureInkToPdfPaths } from '#core/client/index.js';

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
  simulatePressure?: boolean;
}

export interface SignaturePlacement {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface InkSurfaceSize {
  width: number;
  height: number;
}

export interface SigningContributor {
  accountId: string;
  label: string;
}

export interface SigningStamp {
  pageIndex: number;
  strokes: InkStroke[];
  inkColor: SigningInkColor;
  placement: SignaturePlacement;
  inkSize?: number;
  contributedBy: SigningContributor;
}

export interface CanvasPdfMetrics {
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  devicePixelRatio: number;
  viewportTransform: readonly [number, number, number, number, number, number];
}

export interface InkOutlinePoint {
  x: number;
  y: number;
}

export interface InkOutlinePath {
  path: string;
  points: InkOutlinePoint[];
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

const SIGNING_PEN_PRIORITY_MS = 500;
export const DEFAULT_SIGNING_INK_SIZE = 2;
export const MIN_SIGNING_INK_SIZE = 1;
export const MAX_SIGNING_INK_SIZE = 6;
export const PAD_PREVIEW_INK_SIZE = 4;

// WHY: these options keep pressure-sensitive ink legible for signatures while
// damping direction-change thorns seen with the previous centerline renderer.
const PERFECT_FREEHAND_INK_OPTIONS = {
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  last: true,
} satisfies StrokeOptions;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const cloneStrokes = (strokes: InkStroke[]): InkStroke[] =>
  strokes.map((stroke) => ({
    ...(stroke.simulatePressure === undefined
      ? {}
      : { simulatePressure: stroke.simulatePressure }),
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

export const pointerEventUsesSimulatedPressure = (
  event: PointerInkEvent,
  pointerType: string,
): boolean => {
  if (pointerType === 'pen') return false;
  const coalesced = event.getCoalescedEvents?.() ?? [];
  const samples = coalesced.length > 0 ? coalesced : [event];
  return samples.every((sample) => sample.pressure <= 0 || sample.pressure === 0.5);
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

export const pointerDrawsInk = ({
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

export const inkBounds = (strokes: InkStroke[]) => {
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
  inkSize,
  pageIndex,
  strokes,
  inkColor,
  placement,
  contributedBy,
}: SigningStamp): SigningStamp => ({
  pageIndex,
  strokes: cloneStrokes(strokes),
  inkColor,
  placement: { ...placement },
  inkSize: inkSize ?? DEFAULT_SIGNING_INK_SIZE,
  contributedBy: { ...contributedBy },
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

const positiveSize = (size: InkSurfaceSize): boolean =>
  size.width > 0 && size.height > 0;

export const fitInkStrokesToPage = ({
  pageSize,
  sourceSize,
  strokes,
  targetPageWidth = 0.25,
  targetPageHeight = 0.16,
}: {
  pageSize: InkSurfaceSize;
  sourceSize: InkSurfaceSize;
  strokes: InkStroke[];
  targetPageWidth?: number;
  targetPageHeight?: number;
}): InkStroke[] => {
  const bounds = inkBounds(strokes);
  const inkWidth = bounds ? bounds.right - bounds.left : 0;
  const inkHeight = bounds ? bounds.bottom - bounds.top : 0;
  if (
    !bounds ||
    inkWidth <= 0 ||
    inkHeight <= 0 ||
    !positiveSize(sourceSize) ||
    !positiveSize(pageSize)
  ) {
    return cloneStrokes(strokes);
  }

  const sourceAspect = (inkWidth * sourceSize.width) / (inkHeight * sourceSize.height);
  const maxCssWidth = pageSize.width * targetPageWidth;
  const maxCssHeight = pageSize.height * targetPageHeight;
  const cssWidth = Math.min(maxCssWidth, maxCssHeight * sourceAspect);
  const cssHeight = cssWidth / sourceAspect;
  const normalizedWidth = cssWidth / pageSize.width;
  const normalizedHeight = cssHeight / pageSize.height;

  return strokes.map((stroke) => ({
    ...(stroke.simulatePressure === undefined
      ? {}
      : { simulatePressure: stroke.simulatePressure }),
    points: stroke.points.map((point) => ({
      ...point,
      x: 0.5 + ((point.x - bounds.left) / inkWidth - 0.5) * normalizedWidth,
      y: 0.5 + ((point.y - bounds.top) / inkHeight - 0.5) * normalizedHeight,
    })),
  }));
};

export const defaultSignaturePlacement = ({
  previouslySignedSource,
  strokes,
}: {
  previouslySignedSource: boolean;
  strokes: InkStroke[];
}): SignaturePlacement => {
  const bounds = inkBounds(strokes);
  if (!bounds) return { offsetX: 0, offsetY: 0, scale: 1 };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const margin = 0.08;
  const targetCenterX = previouslySignedSource
    ? margin + width / 2
    : 1 - margin - width / 2;
  const targetCenterY = 1 - margin - height / 2;
  return {
    offsetX:
      clamp(targetCenterX, margin, 1 - margin) - (bounds.left + bounds.right) / 2,
    offsetY:
      clamp(targetCenterY, margin, 1 - margin) - (bounds.top + bounds.bottom) / 2,
    scale: 1,
  };
};

export const clampSignaturePlacementToPage = (
  strokes: InkStroke[],
  placement: SignaturePlacement,
): SignaturePlacement => {
  const bounds = placedInkBounds(strokes, placement);
  if (!bounds) return { ...placement };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const offsetX =
    width >= 1
      ? placement.offsetX + 0.5 - (bounds.left + bounds.right) / 2
      : clamp(
          placement.offsetX,
          placement.offsetX - bounds.left,
          placement.offsetX + 1 - bounds.right,
        );
  const offsetY =
    height >= 1
      ? placement.offsetY + 0.5 - (bounds.top + bounds.bottom) / 2
      : clamp(
          placement.offsetY,
          placement.offsetY - bounds.top,
          placement.offsetY + 1 - bounds.bottom,
        );
  return {
    ...placement,
    offsetX,
    offsetY,
  };
};

export const signedDigitalSourceHint = ({
  fileName,
  role,
}: {
  fileName: string;
  role: string;
}): boolean =>
  role === 'signed-digital' || /-podpisany(?:-\d+)?\.pdf$/iu.test(fileName.trim());

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
      ? createSigningStamp({
          ...stamp,
          placement: clampSignaturePlacementToPage(stamp.strokes, placement),
        })
      : createSigningStamp(stamp),
  );

export const moveSigningStampToPage = (
  stamps: readonly SigningStamp[],
  stampIndex: number,
  pageIndex: number,
  pageCount: number,
): SigningStamp[] =>
  stamps.map((stamp, index) =>
    index === stampIndex
      ? createSigningStamp({
          ...stamp,
          pageIndex: clamp(pageIndex, 0, Math.max(0, pageCount - 1)),
          placement: clampSignaturePlacementToPage(
            stamp.strokes,
            stamp.placement,
          ),
        })
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

const svgNumber = (value: number): string => String(Number(value.toFixed(4)));

const average = (first: number, second: number): number => (first + second) / 2;

export const outlinePointsToSvgPath = (
  points: readonly InkOutlinePoint[],
): string => {
  if (points.length < 4) return '';
  const first = points[0];
  const second = points[1];
  const third = points[2];
  if (!first || !second || !third) return '';

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

const inkToCssOutlines = (
  strokes: InkStroke[],
  placement: SignaturePlacement,
  metrics: CanvasPdfMetrics,
  inkSize = DEFAULT_SIGNING_INK_SIZE,
): InkOutlinePath[] =>
  strokes.flatMap((stroke) => {
    const bounds = inkBounds(strokes);
    if (!bounds) return [];
    const centerX = ((bounds.left + bounds.right) / 2) * metrics.cssWidth;
    const centerY = ((bounds.top + bounds.bottom) / 2) * metrics.cssHeight;
    const outline = getStroke(
      stroke.points.map((point) => {
        return {
          x: point.x * metrics.cssWidth,
          y: point.y * metrics.cssHeight,
          pressure: point.pressure,
        };
      }),
      {
        ...PERFECT_FREEHAND_INK_OPTIONS,
        size: clamp(inkSize, MIN_SIGNING_INK_SIZE, MAX_SIGNING_INK_SIZE),
        simulatePressure: stroke.simulatePressure ?? false,
      },
    ).map(([x, y]) => ({
      x: centerX + (x - centerX) * placement.scale + placement.offsetX * metrics.cssWidth,
      y: centerY + (y - centerY) * placement.scale + placement.offsetY * metrics.cssHeight,
    }));
    const path = outlinePointsToSvgPath(outline);
    return path.length > 0 ? [{ path, points: outline }] : [];
  });

export const inkToCanvasOutlines = (
  strokes: InkStroke[],
  placement: SignaturePlacement,
  metrics: CanvasPdfMetrics,
  inkSize?: number,
): InkOutlinePath[] =>
  inkToCssOutlines(strokes, placement, metrics, inkSize).map((outline) => {
    const points = outline.points.map((point) => ({
      x: (point.x / metrics.cssWidth) * metrics.backingWidth,
      y: (point.y / metrics.cssHeight) * metrics.backingHeight,
    }));
    return {
      path: outlinePointsToSvgPath(points),
      points,
    };
  });

export const inkToPdfPaths = (
  strokes: InkStroke[],
  placement: SignaturePlacement,
  metrics: CanvasPdfMetrics,
  inkSize?: number,
): InkOutlinePath[] =>
  signatureInkToPdfPaths(
    {
      strokes,
      pageIndex: 0,
      placement,
      inkColor: 'black',
      inkSize: inkSize ?? DEFAULT_SIGNING_INK_SIZE,
    },
    metrics,
  );

export const signedFileName = (sourceName: string): string => {
  const stem = sourceName.replace(/\.pdf$/iu, '');
  const baseStem = stem || 'dokument';
  const signedMatch = /^(.*-podpisany)(?:-(\d+))?$/u.exec(baseStem);
  if (!signedMatch) return `${baseStem}-podpisany.pdf`;
  const signedStem = signedMatch[1] ?? baseStem;
  const currentVersion = signedMatch[2] ? Number(signedMatch[2]) : 1;
  return `${signedStem}-${currentVersion + 1}.pdf`;
};
