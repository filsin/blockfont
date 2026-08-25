import { describe, expect, it } from "vitest";
import { decodeGlyphsFromBinaryBuffer, encodeGlyphsToBinaryBuffer } from "../../src/geometry/shared-buffer";
import { createMinecraftGlyph } from "../../src/core/minecraft-glyph";

describe("SharedArrayBuffer Binary Memory Packing", () => {
  it("encodes and decodes MinecraftGlyph objects accurately to Int32Array view", () => {
    const glyph1 = createMinecraftGlyph({
      codepoint: 65,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 128, y: 0 },
          { x: 128, y: 256 },
          { x: 0, y: 256 },
        ],
      ],
      metrics: { advance: 192, boldOffset: 64, bearingLeft: 0, bearingTop: 256 },
    });

    const glyph2 = createMinecraftGlyph({
      codepoint: 66,
      contours: [],
      metrics: { advance: 128, boldOffset: 64, bearingLeft: 0, bearingTop: 256 },
    });

    const binaryView = encodeGlyphsToBinaryBuffer([glyph1, glyph2]);
    expect(binaryView).toBeInstanceOf(Int32Array);
    expect(binaryView[0]).toBe(2);

    const decoded = decodeGlyphsFromBinaryBuffer(binaryView.buffer);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]!.codepoint).toBe(65);
    expect(decoded[0]!.metrics.advance).toBe(192);
    expect(decoded[0]!.contours).toHaveLength(1);
    expect(decoded[1]!.codepoint).toBe(66);
    expect(decoded[1]!.contours).toHaveLength(0);
  });
});
