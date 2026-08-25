import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import { createLineContour } from "../../src/core/contour";
import { createMinecraftGlyph } from "../../src/core/minecraft-glyph";
import {
  createOpenTypeFont,
  createOpenTypeFonts,
  generateFont,
  generateTtcFont,
  minecraftUnderlineMetrics,
  serializeFont,
} from "../../src/export/index";

function glyph(codepoint = 65, advance = 192) {
  return createMinecraftGlyph({
    codepoint,
    contours: [createLineContour([
      { x: 0, y: 0 },
      { x: 128, y: 0 },
      { x: 128, y: 256 },
      { x: 0, y: 256 },
    ], "counterclockwise")],
    metrics: { advance, boldOffset: 64, bearingLeft: 0, bearingTop: 256 },
  });
}

function tableTags(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  const count = view.getUint16(4, false);
  const tags: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 12 + index * 16;
    let tag = "";
    for (let byte = 0; byte < 4; byte += 1) tag += String.fromCharCode(view.getUint8(offset + byte));
    tags.push(tag);
  }
  return tags;
}

function tableRecord(buffer: ArrayBuffer, expectedTag: string): { offset: number; length: number } {
  const view = new DataView(buffer);
  const count = view.getUint16(4, false);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    let tag = "";
    for (let byte = 0; byte < 4; byte += 1) tag += String.fromCharCode(view.getUint8(record + byte));
    if (tag === expectedTag) {
      return {
        offset: view.getUint32(record + 8, false),
        length: view.getUint32(record + 12, false),
      };
    }
  }
  throw new Error(`Missing ${expectedTag} table`);
}

describe("OpenType font generation", () => {
  it("configures the one-pixel underline in the normalized y-up space", () => {
    expect(minecraftUnderlineMetrics()).toEqual({
      top: -128,
      bottom: -256,
      position: -128,
      thickness: 128,
    });
  });

  it("generates and round-trips all four named variants", () => {
    const fonts = createOpenTypeFonts([glyph()]);
    expect(fonts.regular.getEnglishName("fontSubfamily")).toBe("Regular");
    expect(fonts.bold.getEnglishName("fontSubfamily")).toBe("Bold");
    expect(fonts.italic.getEnglishName("fontSubfamily")).toBe("Italic");
    expect(fonts.boldItalic.getEnglishName("fontSubfamily")).toBe("Bold Italic");

    for (const font of Object.values(fonts)) {
      const bytes = serializeFont(font);
      expect(new Uint8Array(bytes).slice(0, 4)).toEqual(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]));
      expect(tableTags(bytes)).toEqual(expect.arrayContaining(["CFF ", "post", "name", "OS/2"]));
      const loaded = parse(bytes);
      expect(loaded.getEnglishName("fontFamily")).toBe("BlockFont");
      expect(loaded.numGlyphs).toBe(2);
      expect(loaded.charToGlyph("A").advanceWidth).toBeGreaterThan(0);
      expect(loaded.tables.post?.underlineThickness).toBe(128);
      expect(loaded.tables.post?.underlinePosition).toBe(-128);
    }
  });

  it("preserves advance independently from visible bounds", () => {
    const font = createOpenTypeFont([glyph()], "italic");
    expect(font.charToGlyph("A").advanceWidth).toBe(192);
    expect(font.charToGlyph("A").getBoundingBox().x2).toBeGreaterThan(128);
  });

  it("writes a real TrueType file, not an OTTO/CFF file", () => {
    for (const style of ["regular", "bold", "italic", "boldItalic"] as const) {
      const generated = generateFont([glyph()], style, { format: "ttf" });
      const bytes = new Uint8Array(generated.bytes);
      expect(generated.format).toBe("ttf");
      expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
      expect(tableTags(generated.bytes)).toEqual(expect.arrayContaining([
        "OS/2", "cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post",
      ]));
      expect(tableTags(generated.bytes)).not.toContain("CFF ");
      const loaded = parse(generated.bytes);
      expect(loaded.outlinesFormat).toBe("truetype");
      expect(loaded.getEnglishName("fontSubfamily")).toBe(
        style === "boldItalic" ? "Bold Italic" : style[0]!.toUpperCase() + style.slice(1),
      );
      expect(loaded.charToGlyph("A").advanceWidth).toBe(style === "bold" || style === "boldItalic" ? 256 : 192);
      expect(loaded.charToGlyph("A").getBoundingBox().x2).toBeGreaterThan(0);
      expect(loaded.tables.post?.underlineThickness).toBe(128);
      expect(loaded.tables.post?.underlinePosition).toBe(-128);
    }
  });

  it("writes coherent format 4 and format 12 cmap subtables together", () => {
    const generated = generateFont([glyph(), glyph(0x1f600, 320)], "regular", { format: "ttf" });
    const bytes = new Uint8Array(generated.bytes);
    expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);

    const cmap = tableRecord(generated.bytes, "cmap");
    const view = new DataView(generated.bytes);
    const cmapStart = cmap.offset;
    expect(view.getUint16(cmapStart, false)).toBe(0);
    expect(view.getUint16(cmapStart + 2, false)).toBe(2);

    const subtables = Array.from({ length: 2 }, (_, index) => {
      const record = cmapStart + 4 + index * 8;
      const offset = view.getUint32(record + 4, false);
      return {
        offset,
        format: view.getUint16(cmapStart + offset, false),
      };
    });
    const format4 = subtables.find((subtable) => subtable.format === 4)!;
    const format12 = subtables.find((subtable) => subtable.format === 12)!;
    expect(format4.offset).toBe(20);

    const format4Start = cmapStart + format4.offset;
    const segmentCount = view.getUint16(format4Start + 6, false) / 2;
    const format4Length = view.getUint16(format4Start + 2, false);
    expect(format4Length).toBe(16 + segmentCount * 8);
    expect(view.getUint16(format4Start + 14 + segmentCount * 2, false)).toBe(0);
    expect(format4Start + format4Length).toBe(cmapStart + format12.offset);
    expect(cmapStart + format12.offset + view.getUint32(cmapStart + format12.offset + 4, false))
      .toBeLessThanOrEqual(cmapStart + cmap.length);

    const loaded = parse(generated.bytes);
    const latin = loaded.charToGlyph("A");
    const emoji = loaded.charToGlyph("😀");
    expect(latin.index).not.toBe(emoji.index);
    expect(latin.advanceWidth).toBe(192);
    expect(emoji.advanceWidth).toBe(320);
  });

  it("keeps U+FFFF in the format 12 cmap mapping", () => {
    const generated = generateFont([glyph(), glyph(0xffff, 320)], "regular", { format: "ttf" });
    const loaded = parse(generated.bytes);
    const special = loaded.charToGlyph(String.fromCodePoint(0xffff));
    expect(special.index).not.toBe(0);
    expect(special.advanceWidth).toBe(320);
  });

  it("rejects duplicate codepoints before constructing ambiguous cmap data", () => {
    expect(() => createOpenTypeFont([glyph(), glyph()], "regular")).toThrow(/Duplicate glyph codepoint/);
  });

  it("writes hhea side-bearing metadata from per-glyph bounds", () => {
    const shifted = createMinecraftGlyph({
      codepoint: 66,
      contours: [createLineContour([
        { x: 64, y: 0 },
        { x: 192, y: 0 },
        { x: 192, y: 128 },
        { x: 64, y: 128 },
      ], "counterclockwise")],
      metrics: { advance: 256, boldOffset: 64, bearingLeft: 64, bearingTop: 128 },
    });
    const generated = generateFont([shifted], "regular", { format: "ttf" });
    const hhea = tableRecord(generated.bytes, "hhea");
    const view = new DataView(generated.bytes);
    expect(view.getInt16(hhea.offset + 14, false)).toBe(0);
    expect(view.getInt16(hhea.offset + 16, false)).toBe(192);
  });

  it("keeps low-level TTF output deterministic without the pipeline wrapper", () => {
    const first = generateFont([glyph()], "regular", { format: "ttf" });
    const second = generateFont([glyph()], "regular", { format: "ttf" });
    expect([...new Uint8Array(first.bytes)]).toEqual([...new Uint8Array(second.bytes)]);
  });

  it("serializes WOFF font files with valid WOFF 1.0 magic bytes", () => {
    const font = createOpenTypeFont([glyph()], "regular");
    const woffBytes = serializeFont(font, "woff");
    const bytes = new Uint8Array(woffBytes);
    expect([...bytes.subarray(0, 4)]).toEqual([0x77, 0x4f, 0x46, 0x46]);
  });

  it("serializes TrueType Collection (.ttc) font files with valid ttcf magic bytes", () => {
    const generated = generateTtcFont([glyph()]);
    const bytes = new Uint8Array(generated.bytes);
    expect([...bytes.subarray(0, 4)]).toEqual([0x74, 0x74, 0x63, 0x66]);
  });

  it("supports excluding styles from TTC collection", () => {
    const generated = generateTtcFont([glyph()], {}, ["bold", "italic"]);
    const bytes = new Uint8Array(generated.bytes);
    expect([...bytes.subarray(0, 4)]).toEqual([0x74, 0x74, 0x63, 0x66]);
    const numFonts = bytes[11];
    expect(numFonts).toBe(2);
  });
});

