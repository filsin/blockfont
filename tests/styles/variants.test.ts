import { describe, expect, it } from "vitest";
import { createLineContour } from "../../src/core/contour";
import { createMinecraftGlyph } from "../../src/core/minecraft-glyph";
import {
  boldGlyph,
  boldItalicGlyph,
  italicGlyph,
  regularGlyph,
} from "../../src/styles/index";

function contains(x: number, y: number, contours: readonly { start: { x: number; y: number }; segments: readonly { type: string; to: { x: number; y: number } }[] }[]): boolean {
  let winding = 0;
  for (const contour of contours) {
    const vertices = [contour.start, ...contour.segments.map((segment) => segment.to)];
    for (let index = 0; index < vertices.length; index += 1) {
      const from = vertices[index]!;
      const to = vertices[(index + 1) % vertices.length]!;
      const cross = (to.x - from.x) * (y - from.y) - (x - from.x) * (to.y - from.y);
      if (from.y <= y) {
        if (to.y > y && cross > 0) winding += 1;
      } else if (to.y <= y && cross < 0) winding -= 1;
    }
  }
  return winding !== 0;
}

function sourceGlyph() {
  return createMinecraftGlyph({
    codepoint: 65,
    contours: [createLineContour([
      { x: 0, y: 0 },
      { x: 128, y: 0 },
      { x: 128, y: 256 },
      { x: 0, y: 256 },
    ], "counterclockwise")],
    metrics: {
      advance: 192,
      boldOffset: 64,
      bearingLeft: 0,
      bearingTop: 256,
    },
  });
}

describe("BlockFont style variants", () => {
  it("keeps Regular geometry and explicit advance", () => {
    const styled = regularGlyph(sourceGlyph());
    expect(styled.metrics.advance).toBe(192);
    expect(styled.contours).toHaveLength(1);
  });

  it("uses provider-specific boldOffset instead of a stroke or global constant", () => {
    const styled = boldGlyph(sourceGlyph());
    expect(styled.metrics.advance).toBe(256);
    expect(styled.contours).toHaveLength(1);
    expect(styled.bounds).toEqual({ xMin: 0, yMin: 0, xMax: 192, yMax: 256 });
  });

  it("unions a partially overlapping bitmap shape while preserving a hole", () => {
    const ring = createMinecraftGlyph({
      codepoint: 66,
      contours: [
        createLineContour([
          { x: 0, y: 0 }, { x: 384, y: 0 }, { x: 384, y: 384 }, { x: 0, y: 384 },
        ], "counterclockwise"),
        createLineContour([
          { x: 128, y: 128 }, { x: 128, y: 256 }, { x: 256, y: 256 }, { x: 256, y: 128 },
        ], "clockwise"),
      ],
      metrics: { advance: 448, boldOffset: 64, bearingLeft: 0, bearingTop: 384 },
    });
    const styled = boldGlyph(ring);
    expect(styled.metrics.advance).toBe(512);
    expect(styled.bounds).toEqual({ xMin: 0, yMin: 0, xMax: 448, yMax: 384 });
    expect(styled.contours.some((contour) => contour.winding === "clockwise")).toBe(true);
    expect(contains(192, 192, styled.contours)).toBe(false);
    expect(contains(32, 32, styled.contours)).toBe(true);
    expect(contains(416, 32, styled.contours)).toBe(true);
  });

  it("keeps Italic advance unchanged while shearing geometry", () => {
    const styled = italicGlyph(sourceGlyph());
    expect(styled.metrics.advance).toBe(192);
    expect(styled.contours[0]?.segments[0]).toEqual({
      type: "line",
      to: { x: 128, y: 0 },
    });
    expect(styled.contours[0]?.segments[1]).toEqual({
      type: "line",
      to: { x: 192, y: 256 },
    });
  });

  it("applies Bold first and shear second for Bold Italic", () => {
    const styled = boldItalicGlyph(sourceGlyph());
    expect(styled.metrics.advance).toBe(256);
    expect(styled.contours).toHaveLength(1);
    expect(styled.bounds?.xMax).toBe(256);
    // Bold first unions [0, 128] with its +64 copy into [0, 192].
    // Shear then maps the y=256 endpoints by +64: 192 -> 256 and 0 -> 64.
    expect(styled.contours[0]?.start).toEqual({ x: 0, y: 0 });
    expect(styled.contours[0]?.segments[0]).toEqual({
      type: "line",
      to: { x: 192, y: 0 },
    });
    expect(styled.contours[0]?.segments[1]).toEqual({
      type: "line",
      to: { x: 256, y: 256 },
    });
    expect(styled.contours[0]?.segments[2]).toEqual({
      type: "line",
      to: { x: 64, y: 256 },
    });
  });
});
