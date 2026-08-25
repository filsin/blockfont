import { describe, expect, it } from "vitest";

import {
  createMinecraftGlyph,
  getGlyphBounds,
  getGlyphVisibleMetrics,
} from "../../src/core/minecraft-glyph";
import { createPathContour } from "../../src/core/contour";

describe("MinecraftGlyph", () => {
  const input = {
    codepoint: 65,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 128, y: 0 },
        { x: 128, y: 128 },
        { x: 0, y: 128 },
      ],
    ],
    metrics: {
      advance: 1024,
      boldOffset: 128,
      bearingLeft: 0,
      bearingTop: 1024,
    },
  } as const;

  it("provides the provider-independent contract", () => {
    const glyph = createMinecraftGlyph(input);

    expect(glyph.codepoint).toBe(65);
    expect(glyph.contours).toHaveLength(1);
    expect(glyph.metrics).toEqual(input.metrics);
    expect(glyph.coordinateSystem).toEqual({
      xAxis: "right",
      yAxis: "up",
      origin: "baseline",
      unit: "fontUnit",
    });
    expect(glyph.fillRule).toBe("nonzero");
    expect(getGlyphBounds(glyph)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 128,
      yMax: 128,
    });
    expect(glyph.bounds).toEqual(getGlyphBounds(glyph));
  });

  it("does not change advance for visible overflow", () => {
    const glyph = createMinecraftGlyph({
      ...input,
      contours: [
        [
          { x: -256, y: 0 },
          { x: 256, y: 0 },
          { x: 256, y: 128 },
          { x: -256, y: 128 },
        ],
      ],
    });

    expect(getGlyphVisibleMetrics(glyph)).toEqual({
      width: 512,
      height: 128,
    });
    expect(glyph.metrics.advance).toBe(input.metrics.advance);
  });

  it("supports contour-less glyphs such as spaces", () => {
    const glyph = createMinecraftGlyph({
      codepoint: 32,
      contours: [],
      metrics: {
        advance: 512,
        boldOffset: 0,
        bearingLeft: 0,
        bearingTop: 0,
      },
    });

    expect(glyph.contours).toEqual([]);
    expect(glyph.bounds).toBeUndefined();
    expect(getGlyphVisibleMetrics(glyph)).toEqual({ width: 0, height: 0 });
    expect(glyph.metrics.advance).toBe(512);
  });

  it("rejects invalid Unicode scalars and malformed contours", () => {
    expect(() => createMinecraftGlyph({ ...input, codepoint: 0x110000 })).toThrow(
      RangeError,
    );
    expect(() =>
      createMinecraftGlyph({
        ...input,
        contours: [[{ x: 0, y: 0 }, { x: 128, y: 0 }]],
      }),
    ).toThrow(RangeError);
  });

  it("rejects open paths at the glyph boundary", () => {
    const openPath = createPathContour({
      start: { x: 0, y: 0 },
      segments: [{ type: "line", to: { x: 128, y: 0 } }],
      closed: false,
      winding: "counterclockwise",
    });

    expect(() =>
      createMinecraftGlyph({
        ...input,
        contours: [openPath],
      }),
    ).toThrow(RangeError);
  });
});
