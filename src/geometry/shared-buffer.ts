import type { MinecraftGlyph } from "../core/minecraft-glyph";
import { createMinecraftGlyph } from "../core/minecraft-glyph";
import type { Contour, PointInput } from "../core/contour";
import { asIntegerFontUnit } from "../core/units";

function getContourVertices(contour: Contour): PointInput[] {
  const points: PointInput[] = [{ x: contour.start.x, y: contour.start.y }];
  for (const segment of contour.segments) {
    points.push({ x: segment.to.x, y: segment.to.y });
  }
  return points;
}

/**
 * Encodes an array of MinecraftGlyph objects into a packed contiguous Int32Array binary buffer.
 * Uses SharedArrayBuffer when available for zero-copy memory access across worker threads.
 */
export function encodeGlyphsToBinaryBuffer(glyphs: readonly MinecraftGlyph[]): Int32Array {
  let totalInts = 1; // glyphCount
  for (const glyph of glyphs) {
    totalInts += 6; // codepoint, advance, boldOffset, bearingLeft, bearingTop, contourCount
    for (const contour of glyph.contours) {
      const vertices = getContourVertices(contour);
      totalInts += 1 + vertices.length * 2; // pointCount + (x, y)*pointCount
    }
  }

  let buffer: ArrayBufferLike;
  if (typeof SharedArrayBuffer !== "undefined") {
    buffer = new SharedArrayBuffer(totalInts * 4);
  } else {
    buffer = new ArrayBuffer(totalInts * 4);
  }

  const view = new Int32Array(buffer);
  view[0] = glyphs.length;
  let offset = 1;

  for (const glyph of glyphs) {
    view[offset++] = glyph.codepoint;
    view[offset++] = glyph.metrics.advance;
    view[offset++] = glyph.metrics.boldOffset;
    view[offset++] = glyph.metrics.bearingLeft;
    view[offset++] = glyph.metrics.bearingTop;
    view[offset++] = glyph.contours.length;

    for (const contour of glyph.contours) {
      const vertices = getContourVertices(contour);
      view[offset++] = vertices.length;
      for (const pt of vertices) {
        view[offset++] = Math.round(pt.x as number);
        view[offset++] = Math.round(pt.y as number);
      }
    }
  }

  return view;
}

/**
 * Decodes a packed contiguous Int32Array binary buffer back into an array of normalized MinecraftGlyph objects.
 */
export function decodeGlyphsFromBinaryBuffer(bufferLike: Int32Array | ArrayBuffer | SharedArrayBuffer): MinecraftGlyph[] {
  const view = bufferLike instanceof Int32Array ? bufferLike : new Int32Array(bufferLike);
  const glyphCount = view[0]!;
  let offset = 1;
  const glyphs: MinecraftGlyph[] = [];

  for (let i = 0; i < glyphCount; i += 1) {
    const codepoint = view[offset++]!;
    const advance = asIntegerFontUnit(view[offset++]!, "advance");
    const boldOffset = asIntegerFontUnit(view[offset++]!, "boldOffset");
    const bearingLeft = asIntegerFontUnit(view[offset++]!, "bearingLeft");
    const bearingTop = asIntegerFontUnit(view[offset++]!, "bearingTop");
    const contourCount = view[offset++]!;

    const contours: PointInput[][] = [];
    for (let c = 0; c < contourCount; c += 1) {
      const pointCount = view[offset++]!;
      const points: PointInput[] = [];
      for (let p = 0; p < pointCount; p += 1) {
        const x = view[offset++]!;
        const y = view[offset++]!;
        points.push({ x, y });
      }
      contours.push(points);
    }

    const glyph = createMinecraftGlyph({
      codepoint,
      contours,
      metrics: {
        advance,
        boldOffset,
        bearingLeft,
        bearingTop,
      },
    });

    glyphs.push(glyph);
  }

  return glyphs;
}
