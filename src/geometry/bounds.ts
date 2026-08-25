import { type BoundingBox, type ContourInput } from "../core/contour";
import { asFontUnit } from "../core/units";
import {
  toGeometryContour,
  type GeometryContour,
  type GeometryContourInput,
} from "./types";

export interface GeometryBounds {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export interface IntegerBounds {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

interface MutableBounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function includePoint(bounds: MutableBounds, x: number, y: number): void {
  bounds.xMin = Math.min(bounds.xMin, x);
  bounds.yMin = Math.min(bounds.yMin, y);
  bounds.xMax = Math.max(bounds.xMax, x);
  bounds.yMax = Math.max(bounds.yMax, y);
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
  return inverse * inverse * inverse * p0
    + 3 * inverse * inverse * t * p1
    + 3 * inverse * t * t * p2
    + t * t * t * p3;
}

function includeQuadraticExtremum(
  bounds: MutableBounds,
  axis: "x" | "y",
  p0: number,
  p1: number,
  p2: number,
): void {
  const denominator = p0 - 2 * p1 + p2;
  if (denominator === 0) return;
  const t = (p0 - p1) / denominator;
  if (t <= 0 || t >= 1) return;
  const value = evaluateQuadratic(p0, p1, p2, t);
  if (axis === "x") {
    bounds.xMin = Math.min(bounds.xMin, value);
    bounds.xMax = Math.max(bounds.xMax, value);
  } else {
    bounds.yMin = Math.min(bounds.yMin, value);
    bounds.yMax = Math.max(bounds.yMax, value);
  }
}

function includeCubicExtrema(
  bounds: MutableBounds,
  axis: "x" | "y",
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): void {
  // The derivative is 3 * (a*t² + 2*b*t + c).
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = p0 - 2 * p1 + p2;
  const c = p1 - p0;
  const epsilon = 1e-12;
  const roots: number[] = [];

  if (Math.abs(a) < epsilon) {
    if (Math.abs(2 * b) >= epsilon) roots.push(-c / (2 * b));
  } else {
    const discriminant = 4 * b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-2 * b - root) / (2 * a), (-2 * b + root) / (2 * a));
    }
  }

  for (const t of roots) {
    if (t <= 0 || t >= 1) continue;
    const value = evaluateCubic(p0, p1, p2, p3, t);
    if (axis === "x") {
      bounds.xMin = Math.min(bounds.xMin, value);
      bounds.xMax = Math.max(bounds.xMax, value);
    } else {
      bounds.yMin = Math.min(bounds.yMin, value);
      bounds.yMax = Math.max(bounds.yMax, value);
    }
  }
}

function freezeBounds(bounds: MutableBounds): GeometryBounds {
  return Object.freeze({ ...bounds });
}

/** Returns exact bounds, including extrema of quadratic and cubic curves. */
export function getExactContourBounds(
  input: GeometryContourInput | ContourInput,
): GeometryBounds | undefined {
  const contour = toGeometryContour(input);
  if (contour.segments.length === 0) return undefined;

  const bounds: MutableBounds = {
    xMin: contour.start.x,
    yMin: contour.start.y,
    xMax: contour.start.x,
    yMax: contour.start.y,
  };
  let current = contour.start;

  for (const segment of contour.segments) {
    switch (segment.type) {
      case "line":
        includePoint(bounds, segment.to.x, segment.to.y);
        break;
      case "quadratic":
        includePoint(bounds, segment.to.x, segment.to.y);
        includeQuadraticExtremum(
          bounds,
          "x",
          current.x,
          segment.control.x,
          segment.to.x,
        );
        includeQuadraticExtremum(
          bounds,
          "y",
          current.y,
          segment.control.y,
          segment.to.y,
        );
        break;
      case "cubic":
        includePoint(bounds, segment.to.x, segment.to.y);
        includeCubicExtrema(
          bounds,
          "x",
          current.x,
          segment.control1.x,
          segment.control2.x,
          segment.to.x,
        );
        includeCubicExtrema(
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

  if (contour.closed) includePoint(bounds, contour.start.x, contour.start.y);
  return freezeBounds(bounds);
}

export function getExactContoursBounds(
  contours: readonly (GeometryContourInput | ContourInput)[],
): GeometryBounds | undefined {
  let result: GeometryBounds | undefined;
  for (const input of contours) {
    const bounds = getExactContourBounds(input);
    if (bounds === undefined) continue;
    result = result === undefined
      ? bounds
      : Object.freeze({
        xMin: Math.min(result.xMin, bounds.xMin),
        yMin: Math.min(result.yMin, bounds.yMin),
        xMax: Math.max(result.xMax, bounds.xMax),
        yMax: Math.max(result.yMax, bounds.yMax),
      });
  }
  return result;
}

/** Rounds only the metadata box outward; geometry and advance remain exact. */
export function roundBoundsOutward(bounds: GeometryBounds): IntegerBounds {
  return Object.freeze({
    xMin: Math.floor(bounds.xMin),
    yMin: Math.floor(bounds.yMin),
    xMax: Math.ceil(bounds.xMax),
    yMax: Math.ceil(bounds.yMax),
  });
}

/** Converts exact numeric bounds to the core's unbranded structural shape. */
export function asCoreBoundingBox(bounds: GeometryBounds): BoundingBox {
  return Object.freeze({
    xMin: asFontUnit(bounds.xMin),
    yMin: asFontUnit(bounds.yMin),
    xMax: asFontUnit(bounds.xMax),
    yMax: asFontUnit(bounds.yMax),
  });
}
