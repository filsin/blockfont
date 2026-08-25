import { describe, expect, it } from "vitest";
import { createPathContour } from "../../src/core/contour";
import {
  getExactContourBounds,
  roundBoundsOutward,
} from "../../src/geometry/index";

describe("geometry bounds", () => {
  it("includes exact asymmetric quadratic and cubic extrema", () => {
    const quadratic = createPathContour({
      start: { x: 0, y: 0 },
      segments: [{ type: "quadratic", control: { x: 3, y: 7 }, to: { x: 10, y: 2 } }],
      closed: true,
      winding: "counterclockwise",
    });
    const cubic = createPathContour({
      start: { x: 0, y: 0 },
      segments: [{
        type: "cubic",
        control1: { x: 2, y: 9 },
        control2: { x: 13, y: -5 },
        to: { x: 15, y: 1 },
      }],
      closed: true,
      winding: "counterclockwise",
    });
    const quadraticBounds = getExactContourBounds(quadratic)!;
    const cubicBounds = getExactContourBounds(cubic)!;
    expect(quadraticBounds.yMax).toBeCloseTo(4.0833333333, 10);
    expect(cubicBounds.xMin).toBe(0);
    expect(cubicBounds.yMin).toBeLessThan(0);
    expect(cubicBounds.xMax).toBeGreaterThan(10);
  });

  it("rounds fractional bounds outward for metadata only", () => {
    const bounds = { xMin: -1.2, yMin: 0.01, xMax: 4.001, yMax: 7.9 };
    expect(roundBoundsOutward(bounds)).toEqual({ xMin: -2, yMin: 0, xMax: 5, yMax: 8 });
  });
});
