import type {
  Contour,
  ContourInput,
  PathSegment,
  Winding,
} from "../core/contour";

/** A coordinate used by geometry stages before an OpenType integer boundary. */
export interface GeometryPoint {
  readonly x: number;
  readonly y: number;
}

export interface GeometryLineSegment {
  readonly type: "line";
  readonly to: GeometryPoint;
}

export interface GeometryQuadraticSegment {
  readonly type: "quadratic";
  readonly control: GeometryPoint;
  readonly to: GeometryPoint;
}

export interface GeometryCubicSegment {
  readonly type: "cubic";
  readonly control1: GeometryPoint;
  readonly control2: GeometryPoint;
  readonly to: GeometryPoint;
}

export type GeometrySegment =
  | GeometryLineSegment
  | GeometryQuadraticSegment
  | GeometryCubicSegment;

/**
 * A path contour with the same shape as the core Contour, but with numeric
 * coordinates.  Fractional coordinates are needed by affine styles such as
 * Italic; integer validation remains an explicit export boundary.
 */
export interface GeometryContour {
  readonly start: GeometryPoint;
  readonly segments: readonly GeometrySegment[];
  readonly closed: boolean;
  readonly winding: Winding;
}

export type GeometryContourInput = GeometryContour | Contour | ContourInput;

export function geometryPoint(x: number, y: number): GeometryPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("Geometry point coordinates must be finite");
  }
  return Object.freeze({ x, y });
}

function geometrySegment(segment: PathSegment | GeometrySegment): GeometrySegment {
  switch (segment.type) {
    case "line":
      return Object.freeze({ type: "line", to: geometryPoint(segment.to.x, segment.to.y) });
    case "quadratic":
      return Object.freeze({
        type: "quadratic",
        control: geometryPoint(segment.control.x, segment.control.y),
        to: geometryPoint(segment.to.x, segment.to.y),
      });
    case "cubic":
      return Object.freeze({
        type: "cubic",
        control1: geometryPoint(segment.control1.x, segment.control1.y),
        control2: geometryPoint(segment.control2.x, segment.control2.y),
        to: geometryPoint(segment.to.x, segment.to.y),
      });
  }
}

function signedPolygonArea(points: readonly GeometryPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current !== undefined && next !== undefined) {
      area += current.x * next.y - next.x * current.y;
    }
  }
  return area / 2;
}

/** Converts either a core path or a legacy polygon to fractional-safe geometry. */
export function toGeometryContour(input: GeometryContourInput): GeometryContour {
  if (Array.isArray(input)) {
    if (input.length < 3) {
      throw new RangeError("A geometry contour must contain at least three points");
    }
    const points = input.map((point) => geometryPoint(point.x, point.y));
    const winding: Winding = signedPolygonArea(points) < 0
      ? "clockwise"
      : "counterclockwise";
    return Object.freeze({
      start: points[0]!,
      segments: Object.freeze(points.slice(1).map((point) =>
        Object.freeze({ type: "line", to: point } as GeometryLineSegment),
      )),
      closed: true,
      winding,
    });
  }

  const path = input as GeometryContour | Contour;
  return Object.freeze({
    start: geometryPoint(path.start.x, path.start.y),
    segments: Object.freeze(path.segments.map(geometrySegment)),
    closed: path.closed,
    winding: path.winding,
  });
}

export function toGeometryContours(
  contours: readonly GeometryContourInput[],
): readonly GeometryContour[] {
  return Object.freeze(contours.map(toGeometryContour));
}

export function cloneGeometryContour(contour: GeometryContourInput): GeometryContour {
  return toGeometryContour(contour);
}
