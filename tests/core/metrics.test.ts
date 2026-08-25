import { describe, expect, it } from "vitest";

import {
  convertMinecraftGlyphMetrics,
  createFontMetrics,
  createGlyphMetrics,
  minecraftVerticalMetricsToOpenType,
} from "../../src/core/metrics";

describe("glyph and font metrics", () => {
  it("converts each provider metric with the shared scale", () => {
    expect(
      convertMinecraftGlyphMetrics({
        advance: 5.5,
        boldOffset: 0.5,
        bearingLeft: -0.5,
        bearingTop: 7,
      }),
    ).toEqual({
      advance: 704,
      boldOffset: 64,
      bearingLeft: -64,
      bearingTop: 896,
    });
  });

  it("keeps advance explicit even when it differs from visible geometry", () => {
    const metrics = createGlyphMetrics({
      advance: 1024,
      boldOffset: 128,
      bearingLeft: -64,
      bearingTop: 896,
    });

    expect(metrics.advance).toBe(1024);
    expect(metrics.bearingLeft).toBe(-64);
  });

  it("validates font-wide metrics without deriving them from glyphs", () => {
    expect(
      createFontMetrics({
        unitsPerEm: 2048,
        baseline: 0,
        ascent: 1024,
        descent: -256,
        lineGap: 0,
        underlinePosition: -128,
        underlineThickness: 128,
      }),
    ).toEqual({
      unitsPerEm: 2048,
      baseline: 0,
      ascent: 1024,
      descent: -256,
      lineGap: 0,
      underlinePosition: -128,
      underlineThickness: 128,
    });

    expect(() =>
      createFontMetrics({
        unitsPerEm: 2048,
        baseline: 1,
        ascent: 1024,
        descent: -256,
        lineGap: 0,
        underlinePosition: -128,
        underlineThickness: 128,
      }),
    ).toThrow(RangeError);

    expect(() =>
      createFontMetrics({
        unitsPerEm: 2048,
        baseline: 0,
        ascent: 1024,
        descent: 256,
        lineGap: 0,
        underlinePosition: -128,
        underlineThickness: 128,
      }),
    ).toThrow(RangeError);
  });

  it("converts Minecraft positive-down vertical metrics to OpenType", () => {
    expect(
      minecraftVerticalMetricsToOpenType({
        baseline: 8,
        ascent: 8,
        descent: 2,
        lineGap: 0,
      }),
    ).toEqual({
      unitsPerEm: 2048,
      baseline: 0,
      ascent: 1024,
      descent: -256,
      lineGap: 0,
    });

    expect(() =>
      minecraftVerticalMetricsToOpenType({
        baseline: 8,
        ascent: 8,
        descent: -2,
      }),
    ).toThrow(RangeError);
  });
});
