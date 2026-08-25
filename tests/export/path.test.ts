import { describe, expect, it } from "vitest";
import { createPathContour } from "../../src/core/contour";
import {
  contourToPathWithBounds,
  pathCommands,
} from "../../src/export/index";

describe("OpenType path adapter", () => {
  it("emits M/L/Q/C/Z without dropping curves or winding", () => {
    const contour = createPathContour({
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 128, y: 0 } },
        { type: "quadratic", control: { x: 192, y: 64 }, to: { x: 256, y: 0 } },
        {
          type: "cubic",
          control1: { x: 256, y: -64 },
          control2: { x: 384, y: -64 },
          to: { x: 384, y: 0 },
        },
      ],
      closed: true,
      winding: "clockwise",
    });
    const result = contourToPathWithBounds(contour);
    expect(pathCommands(result.path).map((command) => command.type)).toEqual(["M", "L", "Q", "C", "Z"]);
    expect(result.bounds?.xMax).toBe(384);
    expect(result.integerBounds?.yMin).toBeLessThan(0);
    expect(result.path.getBoundingBox().x2).toBe(384);
  });

  it("keeps fractional curve bounds exact while rounding only metadata outward", () => {
    const contour = createPathContour({
      start: { x: 0, y: 0 },
      segments: [{ type: "quadratic", control: { x: 128, y: 1 }, to: { x: 256, y: 0 } }],
      closed: true,
      winding: "counterclockwise",
    });
    const result = contourToPathWithBounds(contour);
    expect(result.bounds?.yMax).toBe(0.5);
    expect(result.integerBounds?.yMax).toBe(1);
    expect(result.path.getBoundingBox().y2).toBe(0.5);
  });
});

