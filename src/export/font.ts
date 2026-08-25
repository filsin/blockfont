import { deflateSync } from "node:zlib";


import { Font, Glyph } from "opentype.js";
import type { FontStyle, MinecraftGlyph } from "../core/index";
import {
  DEFAULT_COORDINATE_SCALE,
  DEFAULT_UNITS_PER_EM,
  asIntegerFontUnit,
  createFontMetrics,
  type FontMetrics,
} from "../core/index";
import { roundBoundsOutward } from "../geometry/bounds";
import { contoursToPath } from "./path";
import {
  styleGlyphs,
  type StyledGlyph,
} from "../styles/variants";
import {
  serializeTrueTypeFont,
  serializeTrueTypeCollection,
  type TrueTypeFontOptions,
} from "./ttf";

/** Supported export formats. */
export type SupportedExportFormat = "otf" | "ttf" | "woff" | "ttc";

export interface OpenTypeFontOptions {
  readonly familyName?: string;
  readonly fontMetrics?: FontMetrics;
  readonly unitsPerEm?: number;
  readonly version?: string;
  readonly copyright?: string;
  readonly format?: SupportedExportFormat;
}

export interface GeneratedFont {
  readonly font: Font;
  readonly style: FontStyle;
  readonly format: SupportedExportFormat;
  readonly bytes: ArrayBuffer;
}

export interface UnderlineMetrics {
  readonly top: number;
  readonly bottom: number;
  readonly position: number;
  readonly thickness: number;
}

export class UnsupportedFontFormatError extends Error {
  public readonly format: SupportedExportFormat;

  public constructor(format: SupportedExportFormat) {
    super(`Unsupported OpenType export format: ${format}`);
    this.name = "UnsupportedFontFormatError";
    this.format = format;
  }
}

/** Minecraft's one-pixel underline converted to baseline/y-up OpenType units. */
export function minecraftUnderlineMetrics(
  fontUnitsPerMinecraftPixel = DEFAULT_COORDINATE_SCALE.fontUnitsPerMinecraftPixel,
): UnderlineMetrics {
  if (!Number.isFinite(fontUnitsPerMinecraftPixel) || fontUnitsPerMinecraftPixel <= 0) {
    throw new RangeError("fontUnitsPerMinecraftPixel must be finite and positive");
  }
  const pixel = fontUnitsPerMinecraftPixel;
  const top = -1 * pixel;
  const bottom = -2 * pixel;
  const position = -1 * pixel;
  const thickness = pixel;
  return Object.freeze({
    top,
    bottom,
    position,
    thickness,
  });
}

export function defaultFontMetrics(unitsPerEm = DEFAULT_UNITS_PER_EM): FontMetrics {
  const pixel = unitsPerEm / 16;
  const underline = minecraftUnderlineMetrics(pixel);
  return createFontMetrics({
    unitsPerEm,
    baseline: 0,
    ascent: 9 * pixel,
    descent: -2 * pixel,
    lineGap: 0,
    underlinePosition: underline.position,
    underlineThickness: underline.thickness,
  });
}

function styleName(style: FontStyle): string {
  switch (style) {
    case "regular": return "Regular";
    case "bold": return "Bold";
    case "italic": return "Italic";
    case "boldItalic": return "Bold Italic";
  }
}

function postScriptStyleName(style: FontStyle): string {
  switch (style) {
    case "regular": return "Regular";
    case "bold": return "Bold";
    case "italic": return "Italic";
    case "boldItalic": return "BoldItalic";
  }
}

function weightClass(style: FontStyle): string {
  // @types/opentype.js models these legacy numeric values as strings, while
  // the runtime table encoder correctly expects USHORT values.
  return (style === "bold" || style === "boldItalic" ? 700 : 500) as unknown as string;
}

function toOpenTypeGlyph(styled: StyledGlyph, unitsPerEm: number): Glyph {
  const path = contoursToPath(styled.contours, unitsPerEm);
  const bounds = styled.bounds === undefined ? undefined : roundBoundsOutward(styled.bounds);
  const options = {
    name: `uni${styled.codepoint.toString(16).toUpperCase().padStart(4, "0")}`,
    unicode: styled.codepoint,
    advanceWidth: styled.metrics.advance,
    leftSideBearing: styled.metrics.bearingLeft,
    path,
    ...(bounds === undefined
      ? {}
      : {
          xMin: bounds.xMin,
          yMin: bounds.yMin,
          xMax: bounds.xMax,
          yMax: bounds.yMax,
        }),
  };
  return new Glyph(options);
}

function toOpenTypeGlyphWithCustoms(
  styled: StyledGlyph,
  unitsPerEm: number,
  customName?: string,
  customUnicode?: number,
): Glyph {
  const path = contoursToPath(styled.contours, unitsPerEm);
  const bounds = styled.bounds === undefined ? undefined : roundBoundsOutward(styled.bounds);
  const name = customName ?? `uni${styled.codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
  const unicodes = customUnicode !== undefined ? [customUnicode] : [];
  const options = {
    name,
    unicodes,
    advanceWidth: styled.metrics.advance,
    leftSideBearing: styled.metrics.bearingLeft,
    path,
    ...(bounds === undefined
      ? {}
      : {
          xMin: bounds.xMin,
          yMin: bounds.yMin,
          xMax: bounds.xMax,
          yMax: bounds.yMax,
        }),
  };
  return new Glyph(options);
}


function notdefGlyph(advanceWidth: number, unitsPerEm: number): Glyph {
  const path = contoursToPath([], unitsPerEm);
  return new Glyph({
    name: ".notdef",
    advanceWidth,
    leftSideBearing: 0,
    path,
    xMin: 0,
    yMin: 0,
    xMax: 0,
    yMax: 0,
  });
}

function findTable(sfnt: { fields: Array<{ name: string; value: any }> }, name: string): any | undefined {
  return sfnt.fields.find((field) => field.name === `${name} table`)?.value;
}

function checksum(bytes: readonly number[]): number {
  let paddedLength = bytes.length;
  while (paddedLength % 4 !== 0) paddedLength += 1;
  let sum = 0;
  for (let index = 0; index < paddedLength; index += 4) {
    sum = (sum + (
      ((bytes[index] ?? 0) << 24)
      + ((bytes[index + 1] ?? 0) << 16)
      + ((bytes[index + 2] ?? 0) << 8)
      + (bytes[index + 3] ?? 0)
    )) >>> 0;
  }
  return sum >>> 0;
}

function patchTableField(table: any, fieldName: string, value: number): void {
  if (table === undefined) return;
  table[fieldName] = value;
  const field = table.fields?.find((entry: { name: string }) => entry.name === fieldName);
  if (field !== undefined) field.value = value;
}

/**
 * opentype.js hard-codes a zero-valued post table when serializing. Patch the
 * returned table before encoding so underline values are present in the file.
 */
function installUnderlineSerialization(font: Font, metrics: FontMetrics): void {
  const originalToTables = font.toTables.bind(font);
  font.toTables = () => {
    const sfnt = originalToTables() as any;
    const post = findTable(sfnt, "post");
    patchTableField(post, "underlinePosition", metrics.underlinePosition);
    patchTableField(post, "underlineThickness", metrics.underlineThickness);

    const postRecord = sfnt.fields.find((field: { name: string }) => field.name === "post Table Record")?.value;
    if (postRecord !== undefined && post !== undefined) {
      patchTableField(postRecord, "checkSum", checksum(post.encode()));
    }

    const head = findTable(sfnt, "head");
    patchTableField(head, "checkSumAdjustment", 0);
    const bytesBeforeAdjustment = sfnt.encode();
    patchTableField(head, "checkSumAdjustment", (0xB1B0AFBA - checksum(bytesBeforeAdjustment)) | 0);
    return sfnt;
  };
}

/** Creates a merged font combining Regular, Bold, Italic, and Bold Italic with GSUB & PUA. */
export function buildMergedFontFromStyledGlyphs(
  glyphs: readonly MinecraftGlyph[],
  regStyled: readonly StyledGlyph[],
  boldStyled: readonly StyledGlyph[],
  italicStyled: readonly StyledGlyph[],
  boldItalicStyled: readonly StyledGlyph[],
  options: OpenTypeFontOptions = {},
): Font {
  const unitsPerEm = options.unitsPerEm ?? options.fontMetrics?.unitsPerEm ?? DEFAULT_UNITS_PER_EM;
  const metrics = options.fontMetrics ?? defaultFontMetrics(unitsPerEm);
  if (metrics.unitsPerEm !== unitsPerEm) {
    throw new RangeError("unitsPerEm must match fontMetrics.unitsPerEm");
  }
  const familyName = options.familyName ?? "BlockFont";

  // OpenType GSUB lookup subtables and maxp numGlyphs uint16 max limit (64KB subtable limit).
  const maxMergedCodepoints = 8000;
  const count = Math.min(glyphs.length, maxMergedCodepoints);


  const opentypeGlyphs: Glyph[] = [notdefGlyph(0, unitsPerEm)];
  const substitutions: {
    ss01: { sub: number; by: number }[];
    ss02: { sub: number; by: number }[];
    ss03: { sub: number; by: number }[];
  } = { ss01: [], ss02: [], ss03: [] };

  for (let i = 0; i < count; i += 1) {
    const reg = regStyled[i]!;
    const bold = boldStyled[i]!;
    const italic = italicStyled[i]!;
    const boldItalic = boldItalicStyled[i]!;

    const regGlyph = toOpenTypeGlyph(reg, unitsPerEm);


    const boldPua = reg.codepoint <= 0x0fff ? 0xe000 + reg.codepoint : undefined;
    const italicPua = reg.codepoint <= 0x0fff ? 0xe400 + reg.codepoint : undefined;
    const boldItalicPua = reg.codepoint <= 0x0fff ? 0xe800 + reg.codepoint : undefined;

    const boldGlyph = toOpenTypeGlyphWithCustoms(bold, unitsPerEm, `${regGlyph.name}.bold`, boldPua);
    const italicGlyph = toOpenTypeGlyphWithCustoms(italic, unitsPerEm, `${regGlyph.name}.italic`, italicPua);
    const boldItalicGlyph = toOpenTypeGlyphWithCustoms(boldItalic, unitsPerEm, `${regGlyph.name}.boldItalic`, boldItalicPua);

    const regIndex = opentypeGlyphs.length;
    opentypeGlyphs.push(regGlyph);

    const boldIndex = opentypeGlyphs.length;
    opentypeGlyphs.push(boldGlyph);

    const italicIndex = opentypeGlyphs.length;
    opentypeGlyphs.push(italicGlyph);

    const boldItalicIndex = opentypeGlyphs.length;
    opentypeGlyphs.push(boldItalicGlyph);

    substitutions.ss01.push({ sub: regIndex, by: boldIndex });
    substitutions.ss02.push({ sub: regIndex, by: italicIndex });
    substitutions.ss03.push({ sub: regIndex, by: boldItalicIndex });
  }

  const font = new Font({
    familyName,
    styleName: "Complete",
    fullName: `${familyName} Complete`,
    postScriptName: `${familyName.replace(/\s/g, "")}-Complete`,
    version: options.version ?? "Version 0.1.0",
    copyright: options.copyright ?? "",
    weightClass: 500 as unknown as string,
    fsSelection: 64 as unknown as string,


    unitsPerEm,
    ascender: metrics.ascent,
    descender: metrics.descent,
    glyphs: opentypeGlyphs,
  });
  font.outlinesFormat = "truetype";

  font.createdTimestamp = -2082844800;
  (font.tables as { [name: string]: unknown }).post = {
    underlinePosition: metrics.underlinePosition,
    underlineThickness: metrics.underlineThickness,
  };
  installUnderlineSerialization(font, metrics);

  (font as any).blockfontSubstitutions = substitutions;
  (font as any).blockfontSourceGlyphs = glyphs;
  (font as any).blockfontOptions = options;

  for (const sub of substitutions.ss01) {
    (font.substitution as any).addSingle("ss01", sub);
  }
  for (const sub of substitutions.ss02) {
    (font.substitution as any).addSingle("ss02", sub);
  }
  for (const sub of substitutions.ss03) {
    (font.substitution as any).addSingle("ss03", sub);
  }

  return font;
}

export function createMergedOpenTypeFont(
  glyphs: readonly MinecraftGlyph[],
  options: OpenTypeFontOptions = {},
): Font {
  const regStyled = styleGlyphs(glyphs, "regular");
  const boldStyled = styleGlyphs(glyphs, "bold");
  const italicStyled = styleGlyphs(glyphs, "italic");
  const boldItalicStyled = styleGlyphs(glyphs, "boldItalic");
  return buildMergedFontFromStyledGlyphs(glyphs, regStyled, boldStyled, italicStyled, boldItalicStyled, options);
}

export function createOpenTypeFontFromStyled(
  styled: readonly StyledGlyph[],
  style: FontStyle,
  options: OpenTypeFontOptions = {},
): Font {
  const unitsPerEm = options.unitsPerEm ?? options.fontMetrics?.unitsPerEm ?? DEFAULT_UNITS_PER_EM;
  const metrics = options.fontMetrics ?? defaultFontMetrics(unitsPerEm);
  if (metrics.unitsPerEm !== unitsPerEm) {
    throw new RangeError("unitsPerEm must match fontMetrics.unitsPerEm");
  }
  const seenCodepoints = new Set<number>();
  for (const glyph of styled) {
    if (seenCodepoints.has(glyph.codepoint)) {
      throw new RangeError(
        `Duplicate glyph codepoint: U+${glyph.codepoint.toString(16).toUpperCase().padStart(4, "0")}`,
      );
    }
    seenCodepoints.add(glyph.codepoint);
  }
  const familyName = options.familyName ?? "BlockFont";
  // OpenType maxp.numGlyphs uint16 max limit = 65,535 (1 .notdef + 65,534 glyphs).
  const targetStyled = styled.length > 65534 ? styled.slice(0, 65534) : styled;
  const opentypeGlyphs = [
    notdefGlyph(0, unitsPerEm),
    ...targetStyled.map((glyph) => toOpenTypeGlyph(glyph, unitsPerEm)),
  ];
  const font = new Font({
    familyName,
    styleName: styleName(style),
    fullName: `${familyName} ${styleName(style)}`,
    postScriptName: `${familyName.replace(/\s/g, "")}-${postScriptStyleName(style)}`,
    version: options.version ?? "Version 0.1.0",
    copyright: options.copyright ?? "",
    weightClass: weightClass(style),
    fsSelection: (style === "regular" ? 64 : style === "bold" ? 32 : style === "boldItalic" ? 33 : 1) as unknown as string,
    unitsPerEm,
    ascender: metrics.ascent,
    descender: metrics.descent,
    glyphs: opentypeGlyphs,
  });
  font.createdTimestamp = -2082844800;
  (font.tables as { [name: string]: unknown }).post = {
    underlinePosition: metrics.underlinePosition,
    underlineThickness: metrics.underlineThickness,
  };
  installUnderlineSerialization(font, metrics);
  return font;
}



/** Creates an opentype.js Font for one of the BlockFont styles. */
export function createOpenTypeFont(
  glyphs: readonly MinecraftGlyph[],
  style: FontStyle,
  options: OpenTypeFontOptions = {},
): Font {
  const styled = styleGlyphs(glyphs, style);
  const font = createOpenTypeFontFromStyled(styled, style, options);
  (font as any).blockfontSourceGlyphs = glyphs;
  (font as any).blockfontOptions = options;
  return font;
}


export function createOpenTypeFonts(
  glyphs: readonly MinecraftGlyph[],
  options: OpenTypeFontOptions = {},
): Readonly<Record<"regular" | "bold" | "italic" | "boldItalic", Font>> {
  return Object.freeze({
    regular: createOpenTypeFont(glyphs, "regular", options),
    bold: createOpenTypeFont(glyphs, "bold", options),
    italic: createOpenTypeFont(glyphs, "italic", options),
    boldItalic: createOpenTypeFont(glyphs, "boldItalic", options),
  });
}


/** Encodes an sfnt ArrayBuffer (TTF/OTF) into a compressed WOFF 1.0 container. */
export function serializeWoffFont(sfntBuffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(sfntBuffer);
  const bytes = new Uint8Array(sfntBuffer);

  const flavor = view.getUint32(0);
  const numTables = view.getUint16(4);
  const totalSfntSize = bytes.length;

  interface TableHeader {
    tag: number;
    checksum: number;
    origOffset: number;
    origLength: number;
    compData: Uint8Array;
    compLength: number;
  }

  const tables: TableHeader[] = [];
  let headerOffset = 12;

  for (let i = 0; i < numTables; i += 1) {
    const tag = view.getUint32(headerOffset);
    const checksumVal = view.getUint32(headerOffset + 4);
    const origOffset = view.getUint32(headerOffset + 8);
    const origLength = view.getUint32(headerOffset + 12);
    headerOffset += 16;

    const data = bytes.subarray(origOffset, origOffset + origLength);
    const compressed = deflateSync(data);
    const useCompressed = compressed.length < data.length;

    tables.push({
      tag,
      checksum: checksumVal,
      origOffset,
      origLength,
      compData: useCompressed ? compressed : data,
      compLength: useCompressed ? compressed.length : data.length,
    });
  }

  // WOFF Header (44 bytes)
  const numTablesVal = tables.length;
  const woffHeaderSize = 44;
  const tableDirSize = numTablesVal * 20;
  let currentOffset = woffHeaderSize + tableDirSize;

  const tableOffsets: number[] = [];
  for (const table of tables) {
    tableOffsets.push(currentOffset);
    currentOffset += table.compLength;
    // Align table data to 4-byte boundaries
    const padding = (4 - (currentOffset % 4)) % 4;
    currentOffset += padding;
  }

  const totalWoffSize = currentOffset;
  const woffBuffer = new ArrayBuffer(totalWoffSize);
  const woffView = new DataView(woffBuffer);
  const woffBytes = new Uint8Array(woffBuffer);

  // Magic 'wOFF'
  woffView.setUint32(0, 0x774f4646);
  // Flavor
  woffView.setUint32(4, flavor);
  // Length
  woffView.setUint32(8, totalWoffSize);
  // NumTables
  woffView.setUint16(12, numTablesVal);
  // Reserved
  woffView.setUint16(14, 0);
  // TotalSfntSize
  woffView.setUint32(16, totalSfntSize);
  // MajorVersion & MinorVersion
  woffView.setUint16(20, 1);
  woffView.setUint16(22, 0);
  // MetaOffset, MetaLength, MetaOrigLength
  woffView.setUint32(24, 0);
  woffView.setUint32(28, 0);
  woffView.setUint32(32, 0);
  // PrivOffset, PrivLength
  woffView.setUint32(36, 0);
  woffView.setUint32(40, 0);

  // Table directory
  const paddedBuffers: Uint8Array[] = [];
  for (let i = 0; i < numTablesVal; i += 1) {
    const table = tables[i]!;
    const padding = (4 - (table.compLength % 4)) % 4;
    if (padding > 0) {
      const padded = new Uint8Array(table.compLength + padding);
      padded.set(table.compData);
      paddedBuffers.push(padded);
    } else {
      paddedBuffers.push(table.compData);
    }
  }

  let dirOffset = 44;
  for (let i = 0; i < numTables; i += 1) {
    const table = tables[i]!;
    woffView.setUint32(dirOffset, table.tag);
    woffView.setUint32(dirOffset + 4, tableOffsets[i]!);
    woffView.setUint32(dirOffset + 8, table.compLength);
    woffView.setUint32(dirOffset + 12, table.origLength);
    woffView.setUint32(dirOffset + 16, table.checksum);
    dirOffset += 20;
  }

  // Table payload
  for (let i = 0; i < numTablesVal; i += 1) {
    woffBytes.set(paddedBuffers[i]!, tableOffsets[i]!);
  }

  return woffBuffer;
}

function fontToTrueTypeOptions(font: Font): TrueTypeFontOptions {
  const post = (font.tables as { [name: string]: { underlinePosition?: number; underlineThickness?: number } }).post;
  const os2 = (font.tables as { [name: string]: { usWeightClass?: number; fsSelection?: number } }).os2;
  const hhea = (font.tables as { [name: string]: { lineGap?: number } }).hhea;
  const substitutions = (font as any).blockfontSubstitutions;

  return {
    familyName: font.getEnglishName("fontFamily"),
    styleName: font.getEnglishName("fontSubfamily"),
    fullName: font.getEnglishName("fullName"),
    postScriptName: font.getEnglishName("postScriptName"),
    version: font.getEnglishName("version"),
    copyright: font.getEnglishName("copyright"),
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    lineGap: hhea?.lineGap ?? 0,
    underlinePosition: post?.underlinePosition ?? minecraftUnderlineMetrics().position,
    underlineThickness: post?.underlineThickness ?? minecraftUnderlineMetrics().thickness,
    weightClass: os2?.usWeightClass ?? 500,
    fsSelection: os2?.fsSelection ?? 64,
    substitutions,
  };
}

/** Serializes font to requested format (ttf, otf, woff, ttc). */
export function serializeFont(
  font: Font,
  format: SupportedExportFormat = "otf",
): ArrayBuffer {
  if (format === "woff") {
    const ttfBytes = serializeFont(font, "ttf");
    return serializeWoffFont(ttfBytes);
  }
  if (format === "ttc") {
    const sourceGlyphs = (font as any).blockfontSourceGlyphs as readonly MinecraftGlyph[] | undefined;
    const options = ((font as any).blockfontOptions ?? {}) as OpenTypeFontOptions;
    if (sourceGlyphs !== undefined && sourceGlyphs.length > 0) {
      const family = createOpenTypeFonts(sourceGlyphs, options);
      const fontList = [
        { font: family.regular, options: fontToTrueTypeOptions(family.regular) },
        { font: family.bold, options: fontToTrueTypeOptions(family.bold) },
        { font: family.italic, options: fontToTrueTypeOptions(family.italic) },
        { font: family.boldItalic, options: fontToTrueTypeOptions(family.boldItalic) },
      ];
      return serializeTrueTypeCollection(fontList);
    }
    const singleOptions = fontToTrueTypeOptions(font);
    return serializeTrueTypeCollection([{ font, options: singleOptions }]);
  }
  if (format === "ttf") {
    const singleOptions = fontToTrueTypeOptions(font);
    return serializeTrueTypeFont(font, singleOptions);
  }
  if (format === "otf") {
    if (font.glyphs.length > 8000) {
      const singleOptions = fontToTrueTypeOptions(font);
      return serializeTrueTypeFont(font, singleOptions);
    }
    return font.toArrayBuffer();
  }
  throw new UnsupportedFontFormatError(format);
}

export function generateTtcFont(
  glyphs: readonly MinecraftGlyph[],
  options: OpenTypeFontOptions = {},
  exclude: readonly FontStyle[] = [],
): GeneratedFont {
  const allStyles: readonly FontStyle[] = ["regular", "bold", "italic", "boldItalic"];
  const excludedSet = new Set(exclude);
  const targetStyles = allStyles.filter((s) => !excludedSet.has(s));
  if (targetStyles.length === 0) {
    throw new RangeError("At least one style must be included in the TTC collection");
  }
  const fontList = targetStyles.map((style) => {
    const font = createOpenTypeFont(glyphs, style, options);
    return { font, options: fontToTrueTypeOptions(font) };
  });
  const bytes = serializeTrueTypeCollection(fontList);
  return Object.freeze({
    font: fontList[0]!.font,
    style: "regular",
    format: "ttc",
    bytes,
  });
}

export function generateFont(
  glyphs: readonly MinecraftGlyph[],
  style: FontStyle,
  options: OpenTypeFontOptions = {},
): GeneratedFont {
  const format = options.format ?? "otf";
  if (format === "ttc") {
    return generateTtcFont(glyphs, options);
  }
  const font = createOpenTypeFont(glyphs, style, options);
  return Object.freeze({ font, style, format, bytes: serializeFont(font, format) });
}

export const createFont = createOpenTypeFont;
export const createFonts = createOpenTypeFonts;

