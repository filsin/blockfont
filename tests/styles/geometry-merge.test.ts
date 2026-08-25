import { describe, expect, it } from "vitest";
import { createLineContour } from "../../src/core/contour";
import { createMinecraftGlyph } from "../../src/core/minecraft-glyph";
import {
  boldGlyph,
  boldItalicGlyph,
  italicGlyph,
  mergeOrthogonalContours,
  regularGlyph,
} from "../../src/styles/index";

describe("Geometry Merging & Spacing Integrity (merge-geometry branch)", () => {
  it("merges two overlapping orthogonal contours into a single outer boundary", () => {
    const box1 = createLineContour([
      { x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 256 }, { x: 0, y: 256 },
    ], "counterclockwise");

    const box2 = createLineContour([
      { x: 64, y: 0 }, { x: 192, y: 0 }, { x: 192, y: 256 }, { x: 64, y: 256 },
    ], "counterclockwise");

    const merged = mergeOrthogonalContours([box1, box2]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.start).toEqual({ x: 0, y: 0 });
    expect(merged[0]?.segments[0]).toEqual({ type: "line", to: { x: 192, y: 0 } });
    expect(merged[0]?.segments[1]).toEqual({ type: "line", to: { x: 192, y: 256 } });
    expect(merged[0]?.segments[2]).toEqual({ type: "line", to: { x: 0, y: 256 } });
  });

  it("strictly preserves advance and bearing metrics across all font styles", () => {
    const glyph = createMinecraftGlyph({
      codepoint: 70, // 'F'
      contours: [createLineContour([
        { x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 256 }, { x: 0, y: 256 },
      ], "counterclockwise")],
      metrics: {
        advance: 192,
        boldOffset: 64,
        bearingLeft: 0,
        bearingTop: 256,
      },
    });

    const reg = regularGlyph(glyph);
    expect(reg.metrics.advance).toBe(192);
    expect(reg.metrics.bearingLeft).toBe(0);
    expect(reg.metrics.bearingTop).toBe(256);

    const bld = boldGlyph(glyph);
    expect(bld.metrics.advance).toBe(256); // 192 + 64 boldOffset
    expect(bld.metrics.bearingLeft).toBe(0);
    expect(bld.metrics.bearingTop).toBe(256);

    const itl = italicGlyph(glyph);
    expect(itl.metrics.advance).toBe(192);
    expect(itl.metrics.bearingLeft).toBe(0);
    expect(itl.metrics.bearingTop).toBe(256);

    const bitl = boldItalicGlyph(glyph);
    expect(bitl.metrics.advance).toBe(256); // 192 + 64 boldOffset
    expect(bitl.metrics.bearingLeft).toBe(0);
    expect(bitl.metrics.bearingTop).toBe(256);
  });

  it("produces a single sheared outer boundary contour for BoldItalic without internal seams", () => {
    const glyph = createMinecraftGlyph({
      codepoint: 72, // 'H'
      contours: [
        createLineContour([
          { x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 256 }, { x: 0, y: 256 },
        ], "counterclockwise"),
      ],
      metrics: {
        advance: 192,
        boldOffset: 64,
        bearingLeft: 0,
        bearingTop: 256,
      },
    });

    const styled = boldItalicGlyph(glyph);
    expect(styled.contours).toHaveLength(1);
    expect(styled.contours[0]?.closed).toBe(true);
    // Verified 1 contour (no internal seams or overlapping edges)
  });
});
