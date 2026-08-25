import {
  asFontUnit,
  asIntegerFontUnit,
  type FontUnit,
  type FontUnitInput,
  type IntegerFontUnit,
} from "./units";

/** A point in the normalized OpenType coordinate space. */
export interface Point {
  readonly x: IntegerFontUnit;
  readonly y: IntegerFontUnit;
}

/** Input point accepted at provider and JSON boundaries. */
export interface PointInput {
  readonly x: FontUnitInput;
  readonly y: FontUnitInput;
}

/** Explicit fill winding for a closed contour. */
export type Winding = "clockwise" | "counterclockwise";

/**
 * OpenType's non-zero fill rule. For the normalized y-up convention, an outer
 * contour is counter-clockwise and a hole is clockwise.
 */
export type FillRule = "nonzero";
export const NON_ZERO_FILL_RULE: FillRule = "nonzero";

export interface LineSegment {
  readonly type: "line";
  readonly to: Point;
}

export interface QuadraticSegment {
  readonly type: "quadratic";
  readonly control: Point;
  readonly to: Point;
}

export interface CubicSegment {
  readonly type: "cubic";
  readonly control1: Point;
  readonly control2: Point;
  readonly to: Point;
}

/** Segment model compatible with OpenType line, quadratic and cubic paths. */
export type PathSegment = LineSegment | QuadraticSegment | CubicSegment;

export interface LineSegmentInput {
  readonly type: "line";
  readonly to: PointInput;
}

export interface QuadraticSegmentInput {
  readonly type: "quadratic";
  readonly control: PointInput;
  readonly to: PointInput;
}

export interface CubicSegmentInput {
  readonly type: "cubic";
  readonly control1: PointInput;
  readonly control2: PointInput;
  readonly to: PointInput;
}

export type PathSegmentInput =
  | LineSegmentInput
  | QuadraticSegmentInput
  | CubicSegmentInput;

/**
 * A closed path contour with explicit closure and winding.
 *
 * The final segment endpoint does not need to repeat `start`: when `closed`
 * is true, the implicit closing edge from the last endpoint to `start` is part
 * of the contour. This avoids duplicating points while preserving closure
 * explicitly for exporters and fill-rule handling.
 */
export interface Contour {
  readonly start: Point;
  readonly segments: readonly PathSegment[];
  readonly closed: boolean;
  readonly winding: Winding;
}

/** Legacy polygon input accepted and normalized into a path contour. */
export type PolygonContourInput = readonly PointInput[];
export type ContourInput = Contour | PolygonContourInput;

/** Bounds of visible geometry, independent from advance and bearings. */
export interface BoundingBox {
  readonly xMin: FontUnit;
  readonly yMin: FontUnit;
  readonly xMax: FontUnit;
  readonly yMax: FontUnit;
}

/** Width and height derived from visible contours only. */
export interface VisibleMetrics {
  readonly width: FontUnit;
  readonly height: FontUnit;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function isWinding(value: unknown): value is Winding {
  return value === "clockwise" || value === "counterclockwise";
}

function clonePoint(point: Point): Point {
  return createPoint(point.x, point.y);
}

function cloneSegment(segment: PathSegment): PathSegment {
  switch (segment.type) {
    case "line":
      return Object.freeze({ type: "line", to: clonePoint(segment.to) });
    case "quadratic":
      return Object.freeze({
        type: "quadratic",
        control: clonePoint(segment.control),
        to: clonePoint(segment.to),
      });
    case "cubic":
      return Object.freeze({
        type: "cubic",
        control1: clonePoint(segment.control1),
        control2: clonePoint(segment.control2),
        to: clonePoint(segment.to),
      });
  }
}

function cloneSegmentInput(segment: PathSegmentInput): PathSegmentInput {
  switch (segment.type) {
    case "line":
      return { type: "line", to: { ...segment.to } };
    case "quadratic":
      return {
        type: "quadratic",
        control: { ...segment.control },
        to: { ...segment.to },
      };
    case "cubic":
      return {
        type: "cubic",
        control1: { ...segment.control1 },
        control2: { ...segment.control2 },
        to: { ...segment.to },
      };
  }
}

/** Creates a point at the integer OpenType grid boundary. */
export function createPoint(x: FontUnitInput, y: FontUnitInput): Point {
  return Object.freeze({
    x: asIntegerFontUnit(x, "Point x"),
    y: asIntegerFontUnit(y, "Point y"),
  });
}

export function createLineSegment(to: PointInput): LineSegment {
  return Object.freeze({ type: "line", to: createPoint(to.x, to.y) });
}

export function createQuadraticSegment(
  control: PointInput,
  to: PointInput,
): QuadraticSegment {
  return Object.freeze({
    type: "quadratic",
    control: createPoint(control.x, control.y),
    to: createPoint(to.x, to.y),
  });
}

export function createCubicSegment(
  control1: PointInput,
  control2: PointInput,
  to: PointInput,
): CubicSegment {
  return Object.freeze({
    type: "cubic",
    control1: createPoint(control1.x, control1.y),
    control2: createPoint(control2.x, control2.y),
    to: createPoint(to.x, to.y),
  });
}

export interface PathContourInput {
  readonly start: PointInput;
  readonly segments: readonly PathSegmentInput[];
  readonly closed: boolean;
  readonly winding: Winding;
}

/** Input helper for contours that are valid for a glyph/export path. */
export type ClosedPathContourInput = Omit<PathContourInput, "closed">;

function normalizeSegment(segment: PathSegmentInput): PathSegment {
  switch (segment.type) {
    case "line":
      return createLineSegment(segment.to);
    case "quadratic":
      return createQuadraticSegment(segment.control, segment.to);
    case "cubic":
      return createCubicSegment(segment.control1, segment.control2, segment.to);
  }
}

/** Creates a validated path contour with explicit closure and winding. */
export function createPathContour(input: PathContourInput): Contour {
  if (typeof input.closed !== "boolean") {
    throw new RangeError("Contour closed must be a boolean");
  }
  if (!isWinding(input.winding)) {
    throw new RangeError("Contour winding must be clockwise or counterclockwise");
  }
  if (input.segments.length === 0) {
    throw new RangeError("A contour must contain at least one segment");
  }

  const contour: Contour = {
    start: createPoint(input.start.x, input.start.y),
    segments: input.segments.map(normalizeSegment),
    closed: input.closed,
    winding: input.winding,
  };

  return Object.freeze({
    start: contour.start,
    segments: Object.freeze(contour.segments.map(cloneSegment)),
    closed: contour.closed,
    winding: contour.winding,
  });
}

/** Creates a contour with the closure required by a glyph. */
export function createClosedPathContour(
  input: ClosedPathContourInput,
): Contour {
  return createPathContour({ ...input, closed: true });
}

/** Returns the signed area of a polygon in the OpenType y-up coordinate system. */
export function getPolygonSignedArea(points: PolygonContourInput): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) {
      continue;
    }
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

/** Infers winding for legacy polygon input before it is normalized. */
export function inferWinding(points: PolygonContourInput): Winding {
  return getPolygonSignedArea(points) < 0 ? "clockwise" : "counterclockwise";
}

/** Converts a polygon into the explicit path representation. */
export function createLineContour(
  points: PolygonContourInput,
  winding = inferWinding(points),
): Contour {
  if (points.length < 3) {
    throw new RangeError("A line contour must contain at least three points");
  }

  const first = points[0];
  if (first === undefined) {
    throw new RangeError("A line contour must contain a start point");
  }

  return createPathContour({
    start: first,
    segments: points.slice(1).map((point) => ({ type: "line", to: point })),
    closed: true,
    winding,
  });
}

/** Returns true for the normalized path representation. */
export function isPathContour(value: ContourInput): value is Contour {
  return !Array.isArray(value);
}

/** Normalizes both explicit paths and legacy polygons into a cloned path. */
export function normalizeContour(
  input: ContourInput,
  polygonWinding?: Winding,
): Contour {
  if (!isPathContour(input)) {
    return createLineContour(input, polygonWinding);
  }

  return createPathContour({
    start: input.start,
    segments: input.segments.map(cloneSegmentInput),
    closed: input.closed,
    winding: input.winding,
  });
}

/** Validates a normalized contour; glyphs additionally require closure. */
export function validateContour(
  contour: Contour,
  options: { readonly requireClosed?: boolean } = {},
): void {
  createPoint(contour.start.x, contour.start.y);
  if (typeof contour.closed !== "boolean") {
    throw new RangeError("Contour closed must be a boolean");
  }
  if (options.requireClosed === true && !contour.closed) {
    throw new RangeError("Glyph contours must be closed");
  }
  if (!isWinding(contour.winding)) {
    throw new RangeError("Contour winding must be clockwise or counterclockwise");
  }
  if (contour.segments.length === 0) {
    throw new RangeError("A contour must contain at least one segment");
  }

  for (const segment of contour.segments) {
    switch (segment.type) {
      case "line":
        createPoint(segment.to.x, segment.to.y);
        break;
      case "quadratic":
        createPoint(segment.control.x, segment.control.y);
        createPoint(segment.to.x, segment.to.y);
        break;
      case "cubic":
        createPoint(segment.control1.x, segment.control1.y);
        createPoint(segment.control2.x, segment.control2.y);
        createPoint(segment.to.x, segment.to.y);
        break;
      default:
        throw new RangeError("Unknown contour segment type");
    }
  }
}

interface BoundsAccumulator {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function includePoint(bounds: BoundsAccumulator, point: Point): void {
  bounds.xMin = Math.min(bounds.xMin, point.x);
  bounds.yMin = Math.min(bounds.yMin, point.y);
  bounds.xMax = Math.max(bounds.xMax, point.x);
  bounds.yMax = Math.max(bounds.yMax, point.y);
}

function includeCoordinate(
  bounds: BoundsAccumulator,
  coordinate: "xMin" | "yMin" | "xMax" | "yMax",
  value: number,
): void {
  assertFinite(value, "Curve coordinate");
  bounds[coordinate] = value;
}

function evaluateQuadratic(p0: number, p1: number, p2: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * p0 + 2 * inverse * t * p1 + t * t * p2;
}

function evaluateCubic(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const inverse = 1 - t;
  return (
    inverse * inverse * inverse * p0 +
    3 * inverse * inverse * t * p1 +
    3 * inverse * t * t * p2 +
    t * t * t * p3
  );
}

function addQuadraticExtremum(
  bounds: BoundsAccumulator,
  axis: "x" | "y",
  p0: number,
  p1: number,
  p2: number,
): void {
  const denominator = p0 - 2 * p1 + p2;
  if (denominator === 0) {
    return;
  }

  const t = (p0 - p1) / denominator;
  if (t <= 0 || t >= 1) {
    return;
  }

  const value = evaluateQuadratic(p0, p1, p2, t);
  if (axis === "x") {
    includeCoordinate(bounds, "xMin", Math.min(bounds.xMin, value));
    includeCoordinate(bounds, "xMax", Math.max(bounds.xMax, value));
  } else {
    includeCoordinate(bounds, "yMin", Math.min(bounds.yMin, value));
    includeCoordinate(bounds, "yMax", Math.max(bounds.yMax, value));
  }
}

function addCubicExtrema(
  bounds: BoundsAccumulator,
  axis: "x" | "y",
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): void {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = p0 - 2 * p1 + p2;
  const c = p1 - p0;
  const quadraticA = a;
  const quadraticB = 2 * b;
  const epsilon = 1e-12;
  const roots: number[] = [];

  if (Math.abs(quadraticA) < epsilon) {
    if (Math.abs(quadraticB) >= epsilon) {
      roots.push(-c / quadraticB);
    }
  } else {
    const discriminant = quadraticB * quadraticB - 4 * quadraticA * c;
    if (discriminant >= 0) {
      const squareRoot = Math.sqrt(discriminant);
      roots.push(
        (-quadraticB - squareRoot) / (2 * quadraticA),
        (-quadraticB + squareRoot) / (2 * quadraticA),
      );
    }
  }

  for (const t of roots) {
    if (t <= 0 || t >= 1) {
      continue;
    }
    const value = evaluateCubic(p0, p1, p2, p3, t);
    if (axis === "x") {
      includeCoordinate(bounds, "xMin", Math.min(bounds.xMin, value));
      includeCoordinate(bounds, "xMax", Math.max(bounds.xMax, value));
    } else {
      includeCoordinate(bounds, "yMin", Math.min(bounds.yMin, value));
      includeCoordinate(bounds, "yMax", Math.max(bounds.yMax, value));
    }
  }
}

function boundsFromPolygon(points: PolygonContourInput): BoundingBox | undefined {
  if (points.length === 0) {
    return undefined;
  }

  const first = points[0];
  if (first === undefined) {
    return undefined;
  }
  const firstPoint = createPoint(first.x, first.y);
  const bounds: BoundsAccumulator = {
    xMin: firstPoint.x,
    yMin: firstPoint.y,
    xMax: firstPoint.x,
    yMax: firstPoint.y,
  };

  for (const point of points) {
    includePoint(bounds, createPoint(point.x, point.y));
  }
  return toBoundingBox(bounds);
}

function toBoundingBox(bounds: BoundsAccumulator): BoundingBox {
  return Object.freeze({
    xMin: asFontUnit(bounds.xMin),
    yMin: asFontUnit(bounds.yMin),
    xMax: asFontUnit(bounds.xMax),
    yMax: asFontUnit(bounds.yMax),
  });
}

/** Returns exact visible bounds, including extrema of quadratic/cubic curves. */
export function getContourBounds(
  contour: ContourInput,
): BoundingBox | undefined {
  if (!isPathContour(contour)) {
    return boundsFromPolygon(contour);
  }

  validateContour(contour);
  const bounds: BoundsAccumulator = {
    xMin: contour.start.x,
    yMin: contour.start.y,
    xMax: contour.start.x,
    yMax: contour.start.y,
  };
  let current = contour.start;

  for (const segment of contour.segments) {
    switch (segment.type) {
      case "line":
        includePoint(bounds, segment.to);
        break;
      case "quadratic":
        includePoint(bounds, segment.to);
        addQuadraticExtremum(
          bounds,
          "x",
          current.x,
          segment.control.x,
          segment.to.x,
        );
        addQuadraticExtremum(
          bounds,
          "y",
          current.y,
          segment.control.y,
          segment.to.y,
        );
        break;
      case "cubic":
        includePoint(bounds, segment.to);
        addCubicExtrema(
          bounds,
          "x",
          current.x,
          segment.control1.x,
          segment.control2.x,
          segment.to.x,
        );
        addCubicExtrema(
          bounds,
          "y",
          current.y,
          segment.control1.y,
          segment.control2.y,
          segment.to.y,
        );
        break;
    }
    current = segment.to;
  }

  if (
    contour.closed &&
    (current.x !== contour.start.x || current.y !== contour.start.y)
  ) {
    includePoint(bounds, contour.start);
  }

  return toBoundingBox(bounds);
}

/** Returns the union bounds of all visible contours, if any. */
export function getContoursBounds(
  contours: readonly ContourInput[],
): BoundingBox | undefined {
  let bounds: BoundingBox | undefined;

  for (const contour of contours) {
    const contourBounds = getContourBounds(contour);
    if (contourBounds === undefined) {
      continue;
    }

    if (bounds === undefined) {
      bounds = contourBounds;
      continue;
    }

    bounds = Object.freeze({
      xMin: asFontUnit(Math.min(bounds.xMin, contourBounds.xMin)),
      yMin: asFontUnit(Math.min(bounds.yMin, contourBounds.yMin)),
      xMax: asFontUnit(Math.max(bounds.xMax, contourBounds.xMax)),
      yMax: asFontUnit(Math.max(bounds.yMax, contourBounds.yMax)),
    });
  }

  return bounds;
}

/**
 * Derives visible width/height from visible bounds only. This function never
 * exposes or calculates an advance: advance is a separate provider metric.
 */
export function getVisibleMetrics(
  contours: readonly ContourInput[],
): VisibleMetrics {
  const bounds = getContoursBounds(contours);
  if (bounds === undefined) {
    return {
      width: asFontUnit(0),
      height: asFontUnit(0),
    };
  }

  return {
    width: asFontUnit(bounds.xMax - bounds.xMin),
    height: asFontUnit(bounds.yMax - bounds.yMin),
  };
}
