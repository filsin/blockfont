import { describe, expect, it } from "vitest";

import {
  createLineContour,
  createClosedPathContour,
  createPathContour,
  createPoint,
  getContourBounds,
  getContoursBounds,
  getVisibleMetrics,
  type PolygonContourInput,
} from "../../src/core/contour";

describe("contours", () => {
  const rectangle: PolygonContourInput = [
    createPoint(128, -256),
    createPoint(384, -256),
    createPoint(384, 128),
    createPoint(128, 128),
  ];

  it("computes visible bounds independently of advance", () => {
    expect(getContourBounds(rectangle)).toEqual({
      xMin: 128,
      yMin: -256,
      xMax: 384,
      yMax: 128,
    });
    expect(getVisibleMetrics([rectangle])).toEqual({
      width: 256,
      height: 384,
    });
  });

  it("returns no visible dimensions for an empty contour set", () => {
    expect(getContoursBounds([[]])).toBeUndefined();
    expect(getVisibleMetrics([])).toEqual({ width: 0, height: 0 });
  });

  it("unions bounds across contours", () => {
    const second: PolygonContourInput = [
      createPoint(-128, -512),
      createPoint(0, -512),
      createPoint(0, -384),
    ];

    expect(getContoursBounds([rectangle, second])).toEqual({
      xMin: -128,
      yMin: -512,
      xMax: 384,
      yMax: 128,
    });
  });

  it("keeps explicit closure and winding for line contours", () => {
    const normalized = createLineContour(rectangle, "clockwise");

    expect(normalized.closed).toBe(true);
    expect(normalized.winding).toBe("clockwise");
    expect(normalized.segments).toHaveLength(3);
    expect(normalized.segments[0]).toEqual({
      type: "line",
      to: { x: 384, y: -256 },
    });
  });

  it("provides a closed-path constructor and rejects unknown winding", () => {
    const contour = createClosedPathContour({
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 128, y: 0 } },
        { type: "line", to: { x: 0, y: 128 } },
      ],
      winding: "counterclockwise",
    });

    expect(contour.closed).toBe(true);
    expect(() =>
      createPathContour({
        start: { x: 0, y: 0 },
        segments: [{ type: "line", to: { x: 128, y: 0 } }],
        closed: true,
        winding: "invalid" as unknown as "clockwise",
      }),
    ).toThrow(RangeError);
  });

  it("computes exact bounds for quadratic and cubic extrema", () => {
    const quadratic = createPathContour({
      start: { x: 0, y: 0 },
      segments: [
        {
          type: "quadratic",
          control: { x: 128, y: 256 },
          to: { x: 256, y: 0 },
        },
      ],
      closed: true,
      winding: "counterclockwise",
    });
    const cubic = createPathContour({
      start: { x: 0, y: 0 },
      segments: [
        {
          type: "cubic",
          control1: { x: 0, y: 384 },
          control2: { x: 384, y: 384 },
          to: { x: 384, y: 0 },
        },
      ],
      closed: true,
      winding: "counterclockwise",
    });

    expect(getContourBounds(quadratic)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 256,
      yMax: 128,
    });
    expect(getContourBounds(cubic)?.xMin).toBe(0);
    expect(getContourBounds(cubic)?.xMax).toBe(384);
    expect(getContourBounds(cubic)?.yMin).toBe(0);
    expect(getContourBounds(cubic)?.yMax).toBe(288);
  });

  it("preserves opposite winding for a glyph with a hole", () => {
    const outer = createLineContour(
      [
        { x: 0, y: 0 },
        { x: 512, y: 0 },
        { x: 512, y: 512 },
        { x: 0, y: 512 },
      ],
      "counterclockwise",
    );
    const hole = createLineContour(
      [
        { x: 128, y: 128 },
        { x: 128, y: 384 },
        { x: 384, y: 384 },
        { x: 384, y: 128 },
      ],
      "clockwise",
    );

    expect(outer.winding).toBe("counterclockwise");
    expect(hole.winding).toBe("clockwise");
    expect(getContoursBounds([outer, hole])).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 512,
      yMax: 512,
    });
  });
});
