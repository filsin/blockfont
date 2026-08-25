import { describe, expect, it } from "vitest";
import { createPathContour } from "../../src/core/contour";
import {
  DEFAULT_ITALIC_SHEAR,
  shearContour,
  translateContour,
} from "../../src/styles/index";

describe("contour transforms", () => {
  const curved = createPathContour({
    start: { x: 0, y: 0 },
    segments: [
      { type: "quadratic", control: { x: 64, y: 128 }, to: { x: 128, y: 0 } },
      { type: "cubic", control1: { x: 128, y: -64 }, control2: { x: 192, y: -64 }, to: { x: 256, y: 0 } },
      { type: "line", to: { x: 0, y: 0 } },
    ],
    closed: true,
    winding: "counterclockwise",
  });

  it("translates every line, quadratic control, and cubic control without changing winding", () => {
    const translated = translateContour(curved, 32, -16);
    expect(translated.start).toEqual({ x: 32, y: -16 });
    expect(translated.segments[0]).toEqual({
      type: "quadratic",
      control: { x: 96, y: 112 },
      to: { x: 160, y: -16 },
    });
    expect(translated.segments[1]).toEqual({
      type: "cubic",
      control1: { x: 160, y: -80 },
      control2: { x: 224, y: -80 },
      to: { x: 288, y: -16 },
    });
    expect(translated.winding).toBe(curved.winding);
  });

  it("shears asymmetric curves with the vanilla coefficient and preserves segment kinds", () => {
    const italic = shearContour(curved);
    expect(DEFAULT_ITALIC_SHEAR).toBe(0.25);
    expect(italic.start).toEqual({ x: 0, y: 0 });
    expect(italic.segments[0]).toEqual({
      type: "quadratic",
      control: { x: 96, y: 128 },
      to: { x: 128, y: 0 },
    });
    expect(italic.segments[1]?.type).toBe("cubic");
    expect(italic.segments[1]).toMatchObject({
      control1: { x: 112, y: -64 },
      control2: { x: 176, y: -64 },
    });
    expect(italic.winding).toBe(curved.winding);
  });
});

