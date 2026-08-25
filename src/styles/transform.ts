import type { ContourInput, Winding } from "../core/contour";
import {
  cloneGeometryContour,
  toGeometryContour,
  type GeometryContour,
  type GeometryContourInput,
  type GeometryPoint,
  type GeometrySegment,
} from "../geometry/types";

export const DEFAULT_ITALIC_SHEAR = 0.25;

function mapPoint(
  point: GeometryPoint,
  transform: (point: GeometryPoint) => GeometryPoint,
): GeometryPoint {
  return transform(point);
}

function mapSegment(
  segment: GeometrySegment,
  transform: (point: GeometryPoint) => GeometryPoint,
): GeometrySegment {
  switch (segment.type) {
    case "line":
      return Object.freeze({ type: "line", to: mapPoint(segment.to, transform) });
    case "quadratic":
      return Object.freeze({
        type: "quadratic",
        control: mapPoint(segment.control, transform),
        to: mapPoint(segment.to, transform),
      });
    case "cubic":
      return Object.freeze({
        type: "cubic",
        control1: mapPoint(segment.control1, transform),
        control2: mapPoint(segment.control2, transform),
        to: mapPoint(segment.to, transform),
      });
  }
}

function transformContour(
  input: GeometryContourInput | ContourInput,
  transform: (point: GeometryPoint) => GeometryPoint,
): GeometryContour {
  const contour = toGeometryContour(input);
  return Object.freeze({
    start: mapPoint(contour.start, transform),
    segments: Object.freeze(contour.segments.map((segment) => mapSegment(segment, transform))),
    closed: contour.closed,
    winding: contour.winding,
  });
}

export function translateContour(
  contour: GeometryContourInput | ContourInput,
  dx: number,
  dy = 0,
): GeometryContour {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new RangeError("Contour translation must be finite");
  }
  return transformContour(contour, (point) => ({ x: point.x + dx, y: point.y + dy }));
}

export function translateContours(
  contours: readonly (GeometryContourInput | ContourInput)[],
  dx: number,
  dy = 0,
): readonly GeometryContour[] {
  return Object.freeze(contours.map((contour) => translateContour(contour, dx, dy)));
}

/** Applies Minecraft's direct italic shear in the normalized y-up space. */
export function shearContour(
  contour: GeometryContourInput | ContourInput,
  shear = DEFAULT_ITALIC_SHEAR,
): GeometryContour {
  if (!Number.isFinite(shear)) throw new RangeError("Contour shear must be finite");
  return transformContour(contour, (point) => ({
    x: point.x + point.y * shear,
    y: point.y,
  }));
}

export function shearContours(
  contours: readonly (GeometryContourInput | ContourInput)[],
  shear = DEFAULT_ITALIC_SHEAR,
): readonly GeometryContour[] {
  return Object.freeze(contours.map((contour) => shearContour(contour, shear)));
}

export function transformContourPoints(
  contour: GeometryContourInput | ContourInput,
  transform: (point: GeometryPoint) => GeometryPoint,
): GeometryContour {
  return transformContour(contour, transform);
}

export function transformContours(
  contours: readonly (GeometryContourInput | ContourInput)[],
  transform: (point: GeometryPoint) => GeometryPoint,
): readonly GeometryContour[] {
  return Object.freeze(contours.map((contour) => transformContour(contour, transform)));
}

/** Keeps a contour's explicit winding when applying an affine transform. */
export function preserveWinding(contour: GeometryContour): Winding {
  return contour.winding;
}

export { cloneGeometryContour };

