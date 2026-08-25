import { describe, expect, it } from "vitest";
import { Font, Glyph, Path } from "opentype.js";
import { PNG } from "pngjs";

describe("MVP dependency compatibility", () => {
  it("compiles and runs against the installed opentype.js API", () => {
    const path = new Path();
    path.moveTo(0, 0);
    path.lineTo(128, 0);
    path.lineTo(128, 128);
    path.closePath();

    const glyph = new Glyph({
      name: "A",
      unicode: 65,
      advanceWidth: 256,
      path,
    });
    const font = new Font({
      familyName: "BlockFont",
      styleName: "Regular",
      unitsPerEm: 2048,
      ascender: 1024,
      descender: -256,
      glyphs: [glyph],
    });

    expect(font.unitsPerEm).toBe(2048);
    expect(font.toArrayBuffer()).toBeInstanceOf(ArrayBuffer);
  });

  it("loads the pngjs types and runtime constructor used by providers", () => {
    const image = new PNG({ width: 1, height: 1 });
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
  });

  it("round-trips a PNG through the sync reader and writer", () => {
    const image = new PNG({ width: 2, height: 1 });
    image.data[0] = 255;
    image.data[1] = 32;
    image.data[2] = 16;
    image.data[3] = 255;

    const encoded = PNG.sync.write(image);
    const decoded = PNG.sync.read(encoded);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 32, 16, 255]);
  });
});
