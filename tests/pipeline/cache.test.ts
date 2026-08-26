import { describe, expect, it } from "vitest";
import { computeGlyphCacheKey, GlyphCacheManager } from "../../src/pipeline/cache";
import type { StyledGlyph } from "../../src/styles/variants";

describe("GlyphCacheManager & Caching Engine", () => {
  it("computes deterministic cache keys for glyphs", () => {
    const key1 = computeGlyphCacheKey({ codepoint: 65, style: "bold", unitsPerEm: 2048 });
    const key2 = computeGlyphCacheKey({ codepoint: 65, style: "bold", unitsPerEm: 2048 });
    const key3 = computeGlyphCacheKey({ codepoint: 65, style: "regular", unitsPerEm: 2048 });

    expect(key1).toBe("v3_65_bold_2048");
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("stores and retrieves StyledGlyph items in-memory and handles cache clearing", () => {
    const manager = new GlyphCacheManager();
    manager.clear();

    const mockGlyph: StyledGlyph = {
      codepoint: 65,
      contours: [],
      bounds: { xMin: 0, yMin: 0, xMax: 128, yMax: 256 },
      metrics: { advance: 192, boldOffset: 64, bearingLeft: 0, bearingTop: 256 },
      fillRule: "nonzero",
      coordinateSystem: "y-up",
      style: "bold",
    };

    const key = computeGlyphCacheKey({ codepoint: 65, style: "bold" });
    expect(manager.get(key)).toBeUndefined();

    manager.set(key, mockGlyph);
    expect(manager.get(key)).toEqual(mockGlyph);

    manager.clear();
    expect(manager.get(key)).toBeUndefined();
  });
});
