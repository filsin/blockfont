import { Path, type PathCommand } from "opentype.js";
import {
  getExactContourBounds,
  getExactContoursBounds,
  roundBoundsOutward,
  type GeometryBounds,
  type IntegerBounds,
} from "../geometry/bounds";
import {
  toGeometryContour,
  type GeometryContour,
  type GeometryContourInput,
} from "../geometry/types";

export interface PathConversionResult {
  readonly path: Path;
  readonly bounds: GeometryBounds | undefined;
  readonly integerBounds: IntegerBounds | undefined;
}

function appendContour(path: Path, input: GeometryContourInput): void {
  const contour = toGeometryContour(input);
  path.moveTo(contour.start.x, contour.start.y);
  for (const segment of contour.segments) {
    switch (segment.type) {
      case "line":
        path.lineTo(segment.to.x, segment.to.y);
        break;
      case "quadratic":
        path.quadraticCurveTo(
          segment.control.x,
          segment.control.y,
          segment.to.x,
          segment.to.y,
        );
        break;
      case "cubic":
        path.curveTo(
          segment.control1.x,
          segment.control1.y,
          segment.control2.x,
          segment.control2.y,
          segment.to.x,
          segment.to.y,
        );
        break;
    }
  }
  if (contour.closed) path.closePath();
}

/** Converts one core/fractional contour without changing its winding. */
export function contourToPath(
  contour: GeometryContourInput,
  unitsPerEm?: number,
): Path {
  const path = new Path();
  if (unitsPerEm !== undefined) path.unitsPerEm = unitsPerEm;
  appendContour(path, contour);
  return path;
}

/** Converts all contours into one OpenType path; command order preserves holes. */
export function contoursToPath(
  contours: readonly GeometryContourInput[],
  unitsPerEm?: number,
): Path {
  const path = new Path();
  if (unitsPerEm !== undefined) path.unitsPerEm = unitsPerEm;
  for (const contour of contours) appendContour(path, contour);
  return path;
}

export function contoursToPathWithBounds(
  contours: readonly GeometryContourInput[],
  unitsPerEm?: number,
): PathConversionResult {
  const path = contoursToPath(contours, unitsPerEm);
  const bounds = getExactContoursBounds(contours);
  return Object.freeze({
    path,
    bounds,
    integerBounds: bounds === undefined ? undefined : roundBoundsOutward(bounds),
  });
}

export function contourToPathWithBounds(
  contour: GeometryContourInput,
  unitsPerEm?: number,
): PathConversionResult {
  const path = contourToPath(contour, unitsPerEm);
  const bounds = getExactContourBounds(contour);
  return Object.freeze({
    path,
    bounds,
    integerBounds: bounds === undefined ? undefined : roundBoundsOutward(bounds),
  });
}

/** Returns a copy of commands for callers that need to inspect M/L/Q/C/Z. */
export function pathCommands(path: Path): readonly PathCommand[] {
  return Object.freeze(path.commands.map((command) => ({ ...command })));
}

export const contourToOpenTypePath = contourToPath;
export const contoursToOpenTypePath = contoursToPath;

