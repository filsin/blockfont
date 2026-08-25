import { describe, expect, it } from "vitest";
import {
  getExactContoursBounds,
  vectorizeBitmap,
  type GeometryContour,
} from "../../src/geometry/index";

function windingNumber(x: number, y: number, contour: GeometryContour): number {
  let result = 0;
  let current = contour.start;
  const points = contour.segments
    .filter((segment) => segment.type === "line")
    .map((segment) => segment.to);
  const vertices = [current, ...points];
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index]!;
    const b = vertices[(index + 1) % vertices.length]!;
    if (a.y <= y) {
      if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) result += 1;
    } else if (b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) {
      result -= 1;
    }
  }
  return result;
}

function rasterize(contours: readonly GeometryContour[], width: number, height: number): boolean[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const winding = contours.reduce((sum, contour) => sum + windingNumber(x + 0.5, y + 0.5, contour), 0);
      return winding !== 0;
    }),
  );
}

describe("bitmap vectorization", () => {
  it("preserves every active and inactive pixel after rasterization", () => {
    const bitmap = [
      [true, false, true, false],
      [true, true, true, false],
      [false, true, false, false],
    ];
    const contours = vectorizeBitmap(bitmap);
    expect(rasterize(contours, 4, 3)).toEqual(bitmap);
    expect(contours.every((contour) => contour.segments.every((segment) => segment.type === "line"))).toBe(true);
  });

  it("fuses adjacent cells into one orthogonal outline", () => {
    const contours = vectorizeBitmap([[true, true], [true, true]]);
    expect(contours).toHaveLength(1);
    // The core contour model stores the closing edge implicitly.
    expect(contours[0]?.segments).toHaveLength(3);
    expect(getExactContoursBounds(contours)).toEqual({ xMin: 0, yMin: 0, xMax: 2, yMax: 2 });
  });

  it("keeps a hole as a separate opposite-winding contour", () => {
    const contours = vectorizeBitmap([
      [true, true, true],
      [true, false, true],
      [true, true, true],
    ]);
    expect(contours).toHaveLength(2);
    expect(contours.map((contour) => contour.winding).sort()).toEqual([
      "clockwise",
      "counterclockwise",
    ]);
    expect(rasterize(contours, 3, 3)).toEqual([
      [true, true, true],
      [true, false, true],
      [true, true, true],
    ]);
  });

  it("keeps diagonal contacts as separate loops with deterministic topology", () => {
    const bitmap = [
      [true, false],
      [false, true],
    ];
    const contours = vectorizeBitmap(bitmap);
    expect(contours).toHaveLength(2);
    expect(rasterize(contours, 2, 2)).toEqual(bitmap);
  });

  it("preserves nested holes and islands pixel-for-pixel", () => {
    const bitmap = [
      [true, true, true, true, true],
      [true, false, false, false, true],
      [true, false, true, false, true],
      [true, false, false, false, true],
      [true, true, true, true, true],
    ];
    const contours = vectorizeBitmap(bitmap);
    expect(contours).toHaveLength(3);
    expect(rasterize(contours, 5, 5)).toEqual(bitmap);
  });

  it("supports PNG row order and normalized cell sizes without altering the grid", () => {
    const contours = vectorizeBitmap([[true], [false]], {
      rowOrder: "top-to-bottom",
      pixelWidth: 128,
      pixelHeight: 128,
      originX: 64,
      originY: -128,
    });
    expect(getExactContoursBounds(contours)).toEqual({
      xMin: 64,
      yMin: 0,
      xMax: 192,
      yMax: 128,
    });
  });
});
