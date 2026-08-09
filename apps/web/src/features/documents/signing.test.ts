import { describe, expect, it } from 'vitest';

import {
  appendSigningStamp,
  canvasCssPointToPdf,
  centeredInkPlacement,
  createSigningStamp,
  defaultSignaturePlacement,
  defaultSigningGestureMode,
  documentPointerDrawsInk,
  fitInkStrokesToPage,
  inkToPdfSegments,
  isPalmSizedTouch,
  placeInkPoint,
  penPriorityActive,
  placedInkBounds,
  pointerEventToInkPoints,
  removeSigningStamp,
  pointerToInkPoint,
  signingStampContainsPoint,
  signingStampsForPage,
  signedFileName,
  signedDigitalSourceHint,
  smoothStroke,
  stampEveryPage,
  updateSigningStampPlacement,
  DEFAULT_SIGNING_INK_COLOR,
  SIGNING_INK_COLORS,
  type CanvasPdfMetrics,
  type InkStroke,
} from './signing.js';

const metrics = (
  viewportTransform: CanvasPdfMetrics['viewportTransform'],
): CanvasPdfMetrics => ({
  cssWidth: 459,
  cssHeight: 594,
  backingWidth: 1836,
  backingHeight: 2376,
  devicePixelRatio: 2,
  viewportTransform,
});

describe('pen signing geometry', () => {
  it('normalizes pointer coordinates and pressure with a mouse fallback', () => {
    expect(
      pointerToInkPoint(60, 120, 0, {
        left: 10,
        top: 20,
        width: 100,
        height: 200,
      }),
    ).toEqual({ x: 0.5, y: 0.5, pressure: 0.5 });
    expect(
      pointerToInkPoint(200, -10, 0.8, {
        left: 10,
        top: 20,
        width: 100,
        height: 200,
      }),
    ).toEqual({ x: 1, y: 0, pressure: 0.8 });
    expect(() =>
      pointerToInkPoint(0, 0, 0, { left: 0, top: 0, width: 0, height: 1 }),
    ).toThrow('positive dimensions');
  });

  it('defines a legible navy ink for canvas and PDF flattening', () => {
    expect(SIGNING_INK_COLORS[1]).toEqual(
      expect.objectContaining({
        id: 'navy',
        canvasColor: '#2244aa',
        pdfColor: { red: 0.13, green: 0.27, blue: 0.67 },
      }),
    );
  });

  it('smooths a polyline with quadratic midpoints and preserves a dot', () => {
    const stroke: InkStroke = {
      points: [
        { x: 0, y: 0, pressure: 0.25 },
        { x: 0.25, y: 0.5, pressure: 0.25 },
        { x: 0.75, y: 1, pressure: 0.75 },
      ],
    };
    expect(smoothStroke(stroke)).toEqual([
      {
        start: stroke.points[0],
        control: stroke.points[1],
        end: { x: 0.5, y: 0.75, pressure: 0.5 },
      },
      {
        start: { x: 0.5, y: 0.75, pressure: 0.5 },
        control: stroke.points[2],
        end: stroke.points[2],
      },
    ]);
    const dot = { points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] };
    expect(smoothStroke(dot)).toEqual([
      { start: dot.points[0], control: dot.points[0], end: dot.points[0] },
    ]);
    expect(smoothStroke({ points: [] })).toEqual([]);
  });

  it('uses the same quadratic curve geometry for PDF paths', () => {
    const segments = inkToPdfSegments(
      [
        {
          points: [
            { x: 0, y: 0, pressure: 0.2 },
            { x: 0.5, y: 0.6, pressure: 0.6 },
            { x: 1, y: 0.2, pressure: 1 },
          ],
        },
      ],
      { offsetX: 0, offsetY: 0, scale: 1 },
      {
        cssWidth: 100,
        cssHeight: 100,
        backingWidth: 100,
        backingHeight: 100,
        devicePixelRatio: 1,
        viewportTransform: [1, 0, 0, -1, 0, 100],
      },
    );

    expect(segments.map((segment) => segment.path)).toEqual([
      'M 0 -100 Q 50 -40 75 -60',
      'M 75 -60 Q 100 -80 100 -80',
    ]);
  });

  it('expands coalesced pointer samples into normalized ink points', () => {
    expect(
      pointerEventToInkPoints(
        {
          clientX: 0,
          clientY: 0,
          pressure: 0.1,
          getCoalescedEvents: () => [
            { clientX: 10, clientY: 20, pressure: 0.2 },
            { clientX: 30, clientY: 60, pressure: 0.6 },
          ],
        },
        { left: 0, top: 0, width: 100, height: 200 },
      ),
    ).toEqual([
      { x: 0.1, y: 0.1, pressure: 0.2 },
      { x: 0.3, y: 0.3, pressure: 0.6 },
    ]);
  });

  it('falls back to the pointer event when coalesced samples are absent or empty', () => {
    const bounds = { left: 10, top: 20, width: 100, height: 200 };

    expect(
      pointerEventToInkPoints(
        { clientX: 60, clientY: 120, pressure: 0.4 },
        bounds,
      ),
    ).toEqual([{ x: 0.5, y: 0.5, pressure: 0.4 }]);
    expect(
      pointerEventToInkPoints(
        {
          clientX: 110,
          clientY: 220,
          pressure: 0.6,
          getCoalescedEvents: () => [],
        },
        bounds,
      ),
    ).toEqual([{ x: 1, y: 1, pressure: 0.6 }]);
  });

  it('defines deterministic document gesture and pen priority rules', () => {
    expect(
      defaultSigningGestureMode({ coarsePointer: true, maxTouchPoints: 0 }),
    ).toBe('pan');
    expect(
      defaultSigningGestureMode({ coarsePointer: false, maxTouchPoints: 2 }),
    ).toBe('pan');
    expect(
      defaultSigningGestureMode({ coarsePointer: false, maxTouchPoints: 0 }),
    ).toBe('draw');
    expect(
      penPriorityActive({
        activePenPointerId: 7,
        lastPenSeenAt: undefined,
        now: 0,
      }),
    ).toBe(true);
    expect(
      penPriorityActive({
        activePenPointerId: undefined,
        lastPenSeenAt: undefined,
        now: 450,
      }),
    ).toBe(false);
    expect(
      penPriorityActive({
        activePenPointerId: undefined,
        lastPenSeenAt: 500,
        now: 450,
      }),
    ).toBe(false);
    expect(
      penPriorityActive({
        activePenPointerId: undefined,
        lastPenSeenAt: 100,
        now: 600,
      }),
    ).toBe(true);
    expect(
      penPriorityActive({
        activePenPointerId: undefined,
        lastPenSeenAt: 100,
        now: 601,
      }),
    ).toBe(false);
    expect(
      isPalmSizedTouch({ pointerType: 'mouse', width: 80, height: 80 }),
    ).toBe(false);
    expect(
      isPalmSizedTouch({ pointerType: 'touch', width: 44, height: 31 }),
    ).toBe(false);
    expect(
      isPalmSizedTouch({ pointerType: 'touch', width: 45, height: 22 }),
    ).toBe(true);
    expect(
      isPalmSizedTouch({ pointerType: 'touch', width: 12, height: 45 }),
    ).toBe(true);
    expect(
      isPalmSizedTouch({ pointerType: 'touch', width: 35, height: 40 }),
    ).toBe(true);
    expect(
      documentPointerDrawsInk({
        mode: 'pan',
        fingerDrawing: true,
        penPriority: false,
        pointer: { pointerType: 'pen' },
      }),
    ).toBe(false);
    expect(
      documentPointerDrawsInk({
        mode: 'draw',
        fingerDrawing: false,
        penPriority: false,
        pointer: { pointerType: 'pen' },
      }),
    ).toBe(true);
    expect(
      documentPointerDrawsInk({
        mode: 'draw',
        fingerDrawing: true,
        penPriority: false,
        pointer: { pointerType: 'touch' },
      }),
    ).toBe(true);
    expect(
      documentPointerDrawsInk({
        mode: 'draw',
        fingerDrawing: false,
        penPriority: false,
        pointer: { pointerType: 'touch' },
      }),
    ).toBe(false);
    expect(
      documentPointerDrawsInk({
        mode: 'draw',
        fingerDrawing: true,
        penPriority: true,
        pointer: { pointerType: 'touch' },
      }),
    ).toBe(false);
    expect(
      documentPointerDrawsInk({
        mode: 'draw',
        fingerDrawing: true,
        penPriority: false,
        pointer: { pointerType: 'touch' },
      }),
    ).toBe(true);
    expect(
      documentPointerDrawsInk({
        mode: 'draw',
        fingerDrawing: false,
        penPriority: false,
        pointer: { pointerType: 'mouse' },
      }),
    ).toBe(true);
  });

  it('inverts CSS, DPR and the unrotated PDF.js viewport transform', () => {
    const point = canvasCssPointToPdf(
      { x: 100, y: 200 },
      metrics([1.5, 0, 0, -1.5, 0, 1188]),
    );
    expect(point.x).toBeCloseTo(133.3333);
    expect(point.y).toBeCloseTo(525.3333);
  });

  it.each([
    {
      rotation: 90,
      transform: [0, 2, 2, 0, 0, 0] as const,
      expected: { x: 200, y: 100 },
    },
    {
      rotation: 180,
      transform: [-2, 0, 0, 2, 1224, 0] as const,
      expected: { x: 512, y: 200 },
    },
    {
      rotation: 270,
      transform: [0, -2, -2, 0, 1584, 1224] as const,
      expected: { x: 412, y: 692 },
    },
  ])('maps a CSS point through a $rotation° page rotation', ({ transform, expected }) => {
    const point = canvasCssPointToPdf(
      { x: 100, y: 200 },
      {
        cssWidth: 792,
        cssHeight: 612,
        backingWidth: 3168,
        backingHeight: 2448,
        devicePixelRatio: 2,
        viewportTransform: transform,
      },
    );
    expect(point.x).toBeCloseTo(expected.x);
    expect(point.y).toBeCloseTo(expected.y);
  });

  it('applies placement, pressure widths and PDF-safe SVG Y coordinates', () => {
    const segments = inkToPdfSegments(
      [
        {
          points: [
            { x: 0.2, y: 0.25, pressure: 0.2 },
            { x: 0.4, y: 0.5, pressure: 1 },
          ],
        },
      ],
      { offsetX: 0.1, offsetY: -0.05, scale: 0.5 },
      {
        cssWidth: 100,
        cssHeight: 200,
        backingWidth: 200,
        backingHeight: 400,
        devicePixelRatio: 2,
        viewportTransform: [1, 0, 0, -1, 0, 200],
      },
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.path).toBe('M 35 -147.5 Q 45 -122.5 45 -122.5');
    expect(segments[0]?.width).toBeCloseTo(3.3333);
  });

  it('renders one- and two-point strokes as PDF curve segments', () => {
    const valid = {
      cssWidth: 100,
      cssHeight: 100,
      backingWidth: 100,
      backingHeight: 100,
      devicePixelRatio: 1,
      viewportTransform: [1, 0, 0, -1, 0, 100] as const,
    };

    expect(
      inkToPdfSegments(
        [{ points: [{ x: 0.2, y: 0.3, pressure: 0.5 }] }],
        { offsetX: 0, offsetY: 0, scale: 1 },
        valid,
      ),
    ).toEqual([
      {
        path: 'M 20 -70 Q 20 -70 20.01 -70',
        width: 2.75,
      },
    ]);
    expect(
      inkToPdfSegments(
        [
          {
            points: [
              { x: 0.2, y: 0.3, pressure: 0.2 },
              { x: 0.4, y: 0.5, pressure: 0.8 },
            ],
          },
        ],
        { offsetX: 0, offsetY: 0, scale: 1 },
        valid,
      )[0]?.path,
    ).toBe('M 20 -70 Q 40 -50 40 -50');
  });

  it('rejects invalid canvas transforms and derives an obvious filename', () => {
    const valid = metrics([1, 0, 0, -1, 0, 792]);
    expect(() =>
      canvasCssPointToPdf(
        { x: 1, y: 1 },
        { ...valid, cssWidth: 0 },
      ),
    ).toThrow('positive');
    expect(() =>
      canvasCssPointToPdf({ x: 1, y: 1 }, { ...valid, cssHeight: 0 }),
    ).toThrow('positive');
    expect(() =>
      canvasCssPointToPdf({ x: 1, y: 1 }, { ...valid, backingWidth: 0 }),
    ).toThrow('positive');
    expect(() =>
      canvasCssPointToPdf({ x: 1, y: 1 }, { ...valid, backingHeight: 0 }),
    ).toThrow('positive');
    expect(() =>
      canvasCssPointToPdf({ x: 1, y: 1 }, { ...valid, devicePixelRatio: 0 }),
    ).toThrow('positive');
    expect(() =>
      canvasCssPointToPdf({ x: 1, y: 1 }, metrics([1, 2, 2, 4, 0, 0])),
    ).toThrow('not invertible');
    const point = { x: 0.2, y: 0.3, pressure: 0.5 };
    expect(placeInkPoint(point, [], { offsetX: 1, offsetY: 1, scale: 2 })).toBe(
      point,
    );
    expect(inkToPdfSegments([], { offsetX: 0, offsetY: 0, scale: 1 }, valid)).toEqual(
      [],
    );
    expect(
      inkToPdfSegments(
        [{ points: [point] }],
        { offsetX: 0, offsetY: 0, scale: 1 },
        valid,
      )[0]?.path,
    ).toContain('Q 183.6 -435.6 183.61 -435.6');
    expect(signedFileName('Umowa.PDF')).toBe('Umowa-podpisany.pdf');
    expect(signedFileName('umowa.pdf')).toBe('umowa-podpisany.pdf');
    expect(signedFileName('umowa-podpisany.pdf')).toBe(
      'umowa-podpisany-2.pdf',
    );
    expect(signedFileName('umowa-podpisany-2.pdf')).toBe(
      'umowa-podpisany-3.pdf',
    );
    expect(signedFileName('.pdf')).toBe('dokument-podpisany.pdf');
    expect(
      signedDigitalSourceHint({ role: 'source', fileName: 'umowa-podpisany.pdf' }),
    ).toBe(true);
    expect(
      signedDigitalSourceHint({ role: 'source', fileName: 'umowa-podpisany-2.pdf' }),
    ).toBe(true);
    expect(
      signedDigitalSourceHint({ role: 'signed-digital', fileName: 'umowa.pdf' }),
    ).toBe(true);
    expect(signedDigitalSourceHint({ role: 'source', fileName: 'umowa.pdf' })).toBe(
      false,
    );
  });

  it('creates immutable stamp snapshots and groups them by page', () => {
    const stroke: InkStroke = {
      points: [
        { x: 0.1, y: 0.2, pressure: 0.4 },
        { x: 0.2, y: 0.3, pressure: 0.7 },
      ],
    };
    const stamp = createSigningStamp({
      pageIndex: 1,
      strokes: [stroke],
      inkColor: DEFAULT_SIGNING_INK_COLOR,
      placement: { offsetX: 0.1, offsetY: 0.2, scale: 0.8 },
    });
    stroke.points[0] = { x: 0.9, y: 0.9, pressure: 1 };

    const stamps = appendSigningStamp([], stamp);

    expect(stamps).toEqual([stamp]);
    expect(stamps[0]?.strokes[0]?.points[0]).toEqual({
      x: 0.1,
      y: 0.2,
      pressure: 0.4,
    });
    expect(signingStampsForPage(stamps, 0)).toEqual([]);
    expect(signingStampsForPage(stamps, 1)).toEqual([
      { stamp: stamps[0], stampIndex: 0 },
    ]);
  });

  it('centers pad ink when converting it into a stamp placement', () => {
    const placement = centeredInkPlacement([
      {
        points: [
          { x: 0.1, y: 0.2, pressure: 0.5 },
          { x: 0.5, y: 0.4, pressure: 0.5 },
        ],
      },
    ]);

    expect(placement.offsetX).toBeCloseTo(0.2);
    expect(placement.offsetY).toBeCloseTo(0.2);
    expect(placement.scale).toBe(1);
    expect(centeredInkPlacement([])).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
    expect(placedInkBounds([], { offsetX: 1, offsetY: 1, scale: 2 })).toBeUndefined();
  });

  it('fits pad ink to page coordinates without destroying its aspect ratio', () => {
    const square = fitInkStrokesToPage({
      strokes: [
        {
          points: [
            { x: 0.2, y: 0.2, pressure: 0.5 },
            { x: 0.6, y: 0.6, pressure: 0.5 },
          ],
        },
      ],
      sourceSize: { width: 300, height: 300 },
      pageSize: { width: 200, height: 300 },
    });
    const squareBounds = placedInkBounds(
      square,
      defaultSignaturePlacement({ previouslySignedSource: false, strokes: square }),
    );
    const squareAspect =
      (((squareBounds?.right ?? 0) - (squareBounds?.left ?? 0)) * 200) /
      (((squareBounds?.bottom ?? 0) - (squareBounds?.top ?? 0)) * 300);

    expect(squareAspect).toBeCloseTo(1, 5);

    const wide = fitInkStrokesToPage({
      strokes: [
        {
          points: [
            { x: 0.1, y: 0.4, pressure: 0.5 },
            { x: 0.9, y: 0.6, pressure: 0.5 },
          ],
        },
      ],
      sourceSize: { width: 400, height: 200 },
      pageSize: { width: 200, height: 300 },
    });
    const wideBounds = placedInkBounds(
      wide,
      defaultSignaturePlacement({ previouslySignedSource: false, strokes: wide }),
    );
    const wideAspect =
      (((wideBounds?.right ?? 0) - (wideBounds?.left ?? 0)) * 200) /
      (((wideBounds?.bottom ?? 0) - (wideBounds?.top ?? 0)) * 300);

    expect(wideAspect).toBeCloseTo(8, 5);
  });

  it('chooses bottom-side default stamp placement by signing round', () => {
    const stroke: InkStroke = {
      points: [
        { x: 0.45, y: 0.45, pressure: 0.5 },
        { x: 0.55, y: 0.55, pressure: 0.5 },
      ],
    };
    const right = placedInkBounds(
      [stroke],
      defaultSignaturePlacement({ previouslySignedSource: false, strokes: [stroke] }),
    );
    const left = placedInkBounds(
      [stroke],
      defaultSignaturePlacement({ previouslySignedSource: true, strokes: [stroke] }),
    );

    expect(right?.right).toBeCloseTo(0.92);
    expect(right?.bottom).toBeCloseTo(0.92);
    expect(left?.left).toBeCloseTo(0.08);
    expect(left?.bottom).toBeCloseTo(0.92);
  });

  it('stamps every page, updates placement and removes individual stamps', () => {
    const stroke: InkStroke = {
      points: [
        { x: 0.2, y: 0.3, pressure: 0.5 },
        { x: 0.4, y: 0.5, pressure: 0.5 },
      ],
    };
    const draft = {
      strokes: [stroke],
      inkColor: SIGNING_INK_COLORS[1],
      placement: { offsetX: 0, offsetY: 0, scale: 1 },
    };
    const stamps = stampEveryPage(
      [],
      draft,
      3,
    );

    expect(stamps.map((stamp) => stamp.pageIndex)).toEqual([0, 1, 2]);
    expect(stamps.every((stamp) => stamp.inkColor.id === 'navy')).toBe(true);
    expect(stampEveryPage(stamps, draft, -1)).toHaveLength(3);

    const moved = updateSigningStampPlacement(stamps, 1, {
      offsetX: 0.2,
      offsetY: -0.1,
      scale: 1.5,
    });
    expect(moved[1]?.placement).toEqual({
      offsetX: 0.2,
      offsetY: -0.1,
      scale: 1.5,
    });
    expect(moved[0]?.placement).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });

    expect(removeSigningStamp(moved, 1).map((stamp) => stamp.pageIndex)).toEqual([
      0,
      2,
    ]);
  });

  it('hit-tests placed stamps with touch-friendly padding', () => {
    const stamp = createSigningStamp({
      pageIndex: 0,
      strokes: [
        {
          points: [
            { x: 0.4, y: 0.4, pressure: 0.5 },
            { x: 0.5, y: 0.5, pressure: 0.5 },
          ],
        },
      ],
      inkColor: DEFAULT_SIGNING_INK_COLOR,
      placement: { offsetX: 0.1, offsetY: -0.1, scale: 1 },
    });

    expect(signingStampContainsPoint(stamp, { x: 0.55, y: 0.35 })).toBe(true);
    expect(signingStampContainsPoint(stamp, { x: 0.51, y: 0.29 })).toBe(true);
    expect(signingStampContainsPoint(stamp, { x: 0.8, y: 0.8 })).toBe(false);
    expect(
      signingStampContainsPoint(
        { ...stamp, strokes: [] },
        { x: 0.55, y: 0.35 },
      ),
    ).toBe(false);
  });
});
