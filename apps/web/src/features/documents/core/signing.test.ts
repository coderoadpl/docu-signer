import { describe, expect, it } from 'vitest';

import {
  canvasCssPointToPdf,
  inkToPdfSegments,
  placeInkPoint,
  pointerToInkPoint,
  signedFileName,
  smoothStroke,
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
  });
});
