import type { Font, Glyph, PathCommand } from "opentype.js";

export interface TrueTypeFontOptions {
  readonly familyName: string;
  readonly styleName: string;
  readonly fullName: string;
  readonly postScriptName: string;
  readonly version: string;
  readonly copyright: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly underlinePosition: number;
  readonly underlineThickness: number;
  readonly weightClass: number;
  readonly fsSelection: number;
  readonly createdTimestamp?: number;
  readonly substitutions?: {
    readonly ss01?: readonly { readonly sub: number; readonly by: number }[];
    readonly ss02?: readonly { readonly sub: number; readonly by: number }[];
    readonly ss03?: readonly { readonly sub: number; readonly by: number }[];
  };
}


interface ByteWriter {
  readonly bytes: number[];
  u8(value: number): void;
  u16(value: number): void;
  i16(value: number): void;
  u32(value: number): void;
  i32(value: number): void;
  tag(value: string): void;
  raw(values: readonly number[]): void;
  pad4(): void;
}

interface TrueTypePoint {
  readonly x: number;
  readonly y: number;
  readonly onCurve: boolean;
}

interface TrueTypeGlyphData {
  readonly bytes: number[];
  readonly points: readonly TrueTypePoint[];
  readonly contourCount: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

interface FontGlyphData {
  readonly glyph: Glyph;
  readonly unicode: number | undefined;
  readonly advanceWidth: number;
  readonly leftSideBearing: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly pathCommands: readonly PathCommand[];
}

interface TableData {
  readonly tag: string;
  readonly bytes: number[];
  readonly length: number;
}

function writer(): ByteWriter {
  const bytes: number[] = [];
  return {
    bytes,
    u8(value) {
      if (!Number.isInteger(value) || value < 0 || value > 0xff) {
        throw new RangeError(`uint8 out of range: ${value}`);
      }
      bytes.push(value);
    },
    u16(value) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
        throw new RangeError(`uint16 out of range: ${value}`);
      }
      bytes.push((value >>> 8) & 0xff, value & 0xff);
    },
    i16(value) {
      if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) {
        throw new RangeError(`int16 out of range: ${value}`);
      }
      bytes.push((value >> 8) & 0xff, value & 0xff);
    },
    u32(value) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`uint32 out of range: ${value}`);
      }
      bytes.push(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      );
    },
    i32(value) {
      if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
        throw new RangeError(`int32 out of range: ${value}`);
      }
      bytes.push(
        (value >> 24) & 0xff,
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff,
      );
    },
    tag(value) {
      if (value.length !== 4) throw new RangeError(`Invalid table tag: ${value}`);
      for (let index = 0; index < value.length; index += 1) {
        bytes.push(value.charCodeAt(index) & 0xff);
      }
    },
    raw(values) {
      for (let index = 0; index < values.length; index += 1) {
        bytes.push(values[index]!);
      }
    },
    pad4() {
      while (bytes.length % 4 !== 0) bytes.push(0);
    },
  };
}

function toInt16(value: number, name: string): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < -0x8000 || rounded > 0x7fff) {
    throw new RangeError(`${name} cannot be represented as int16: ${value}`);
  }
  return rounded;
}

function toUint16(value: number, name: string): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0 || rounded > 0xffff) {
    throw new RangeError(`${name} cannot be represented as uint16: ${value}`);
  }
  return rounded;
}

function finitePoint(x: number | undefined, y: number | undefined): { x: number; y: number } {
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("TrueType outline contains a non-finite point");
  }
  return { x, y };
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * inverse * p0.x
      + 3 * inverse * inverse * t * p1.x
      + 3 * inverse * t * t * p2.x
      + t * t * t * p3.x,
    y: inverse * inverse * inverse * p0.y
      + 3 * inverse * inverse * t * p1.y
      + 3 * inverse * t * t * p2.y
      + t * t * t * p3.y,
  };
}

function quadraticPoint(
  p0: { x: number; y: number },
  control: { x: number; y: number },
  p1: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * p0.x + 2 * inverse * t * control.x + t * t * p1.x,
    y: inverse * inverse * p0.y + 2 * inverse * t * control.y + t * t * p1.y,
  };
}

function splitCubic(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): [
  [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
] {
  const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const p23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
  const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };
  const middle = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };
  return [
    [p0, p01, p012, middle],
    [middle, p123, p23, p3],
  ];
}

interface QuadraticApproximation {
  readonly control: { x: number; y: number };
  readonly end: { x: number; y: number };
}

function approximateCubic(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  depth = 0,
): QuadraticApproximation[] {
  // A TrueType glyf outline is quadratic.  Match the cubic midpoint and
  // subdivide until the quarter points differ by less than 1/16 font unit.
  const midpoint = cubicPoint(p0, p1, p2, p3, 0.5);
  const control = {
    x: 2 * midpoint.x - (p0.x + p3.x) / 2,
    y: 2 * midpoint.y - (p0.y + p3.y) / 2,
  };
  const error = Math.max(
    distanceSquared(cubicPoint(p0, p1, p2, p3, 0.25), quadraticPoint(p0, control, p3, 0.25)),
    distanceSquared(cubicPoint(p0, p1, p2, p3, 0.75), quadraticPoint(p0, control, p3, 0.75)),
  );
  if (error <= 1 / 256 || depth >= 10) return [{ control, end: p3 }];

  const [left, right] = splitCubic(p0, p1, p2, p3);
  return [
    ...approximateCubic(...left, depth + 1),
    ...approximateCubic(...right, depth + 1),
  ];
}

function commandsToContours(commands: readonly PathCommand[]): TrueTypePoint[][] {
  const contours: TrueTypePoint[][] = [];
  let current: { x: number; y: number } | undefined;
  let active: TrueTypePoint[] | undefined;

  const finish = () => {
    if (active !== undefined && active.length > 0) contours.push(active);
    active = undefined;
    current = undefined;
  };

  for (const command of commands) {
    switch (command.type) {
      case "M":
        finish();
        current = finitePoint(command.x, command.y);
        active = [{ ...current, onCurve: true }];
        break;
      case "L":
        if (active === undefined || current === undefined) throw new Error("TTF path has L before M");
        current = finitePoint(command.x, command.y);
        active.push({ ...current, onCurve: true });
        break;
      case "Q":
        if (active === undefined || current === undefined) throw new Error("TTF path has Q before M");
        active.push({ ...finitePoint(command.x1, command.y1), onCurve: false });
        current = finitePoint(command.x, command.y);
        active.push({ ...current, onCurve: true });
        break;
      case "C": {
        if (active === undefined || current === undefined) throw new Error("TTF path has C before M");
        const control1 = finitePoint(command.x1, command.y1);
        const control2 = finitePoint(command.x2, command.y2);
        const end = finitePoint(command.x, command.y);
        for (const approximation of approximateCubic(current, control1, control2, end)) {
          active.push({ ...approximation.control, onCurve: false });
          active.push({ ...approximation.end, onCurve: true });
          current = approximation.end;
        }
        break;
      }
      case "Z":
        // TrueType closes a contour implicitly.  Do not append a duplicate
        // start point; the final-to-first edge is the closing edge.
        finish();
        break;
    }
  }
  finish();
  return contours;
}

function makeGlyphData(commands: readonly PathCommand[]): TrueTypeGlyphData {
  const contours = commandsToContours(commands);
  const points = contours.flat();
  if (points.length === 0) {
    const empty = writer();
    empty.i16(0);
    empty.i16(0);
    empty.i16(0);
    empty.i16(0);
    empty.i16(0);
    empty.u16(0);
    return {
      bytes: empty.bytes,
      points: [],
      contourCount: 0,
      xMin: 0,
      yMin: 0,
      xMax: 0,
      yMax: 0,
    };
  }

  const roundedPoints = points.map((point) => ({
    x: toInt16(point.x, "TrueType point x"),
    y: toInt16(point.y, "TrueType point y"),
    onCurve: point.onCurve,
  }));
  const xMin = Math.min(...roundedPoints.map((point) => point.x));
  const yMin = Math.min(...roundedPoints.map((point) => point.y));
  const xMax = Math.max(...roundedPoints.map((point) => point.x));
  const yMax = Math.max(...roundedPoints.map((point) => point.y));
  const result = writer();
  result.i16(contours.length);
  result.i16(xMin);
  result.i16(yMin);
  result.i16(xMax);
  result.i16(yMax);

  let pointOffset = 0;
  for (const contour of contours) {
    pointOffset += contour.length;
    result.u16(pointOffset - 1);
  }
  result.u16(0); // instructionLength

  // Use uncompressed flags and signed deltas.  This is larger than the
  // short-vector encoding, but keeps the writer simple and fully explicit.
  for (const point of roundedPoints) result.u8(point.onCurve ? 1 : 0);
  let previousX = 0;
  let previousY = 0;
  for (const point of roundedPoints) {
    result.i16(point.x - previousX);
    previousX = point.x;
  }
  for (const point of roundedPoints) {
    result.i16(point.y - previousY);
    previousY = point.y;
  }
  return {
    bytes: result.bytes,
    points: roundedPoints,
    contourCount: contours.length,
    xMin,
    yMin,
    xMax,
    yMax,
  };
}

function checksum(bytes: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < bytes.length; index += 4) {
    sum = (sum + (
      (((bytes[index] ?? 0) << 24) >>> 0)
      + ((bytes[index + 1] ?? 0) << 16)
      + ((bytes[index + 2] ?? 0) << 8)
      + (bytes[index + 3] ?? 0)
    )) >>> 0;
  }
  return sum >>> 0;
}

function utf16be(value: string): number[] {
  const result: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0xffff) {
      result.push((codePoint >>> 8) & 0xff, codePoint & 0xff);
    } else {
      const scalar = codePoint - 0x10000;
      const high = 0xd800 + (scalar >>> 10);
      const low = 0xdc00 + (scalar & 0x3ff);
      result.push((high >>> 8) & 0xff, high & 0xff, (low >>> 8) & 0xff, low & 0xff);
    }
  }
  return result;
}

function makeNameTable(options: TrueTypeFontOptions): number[] {
  const uniqueId = `${options.version};BF;${options.postScriptName}`;
  const names: readonly [number, string][] = [
    [0, options.copyright],
    [1, options.familyName],
    [2, options.styleName],
    [3, uniqueId],
    [4, options.fullName],
    [5, options.version],
    [6, options.postScriptName],
  ];

  const records: { platformId: number; encodingId: number; languageId: number; nameId: number; data: number[] }[] = [];
  for (const [nameId, text] of names) {
    // Windows Unicode BMP record
    records.push({
      platformId: 3,
      encodingId: 1,
      languageId: 0x0409,
      nameId,
      data: utf16be(text),
    });
    // Macintosh Roman record
    records.push({
      platformId: 1,
      encodingId: 0,
      languageId: 0,
      nameId,
      data: Array.from(Buffer.from(text, "latin1")),
    });
  }

  const stringOffset = 6 + records.length * 12;
  const result = writer();
  result.u16(0);
  result.u16(records.length);
  result.u16(stringOffset);

  let offset = 0;
  for (const entry of records) {
    result.u16(entry.platformId);
    result.u16(entry.encodingId);
    result.u16(entry.languageId);
    result.u16(entry.nameId);
    result.u16(entry.data.length);
    result.u16(offset);
    offset += entry.data.length;
  }
  for (const entry of records) result.raw(entry.data);
  return result.bytes;
}

function makeCmapTable(glyphs: readonly FontGlyphData[]): number[] {
  const entries = glyphs
    .map((entry, index) => entry.unicode === undefined
      ? undefined
      : { code: entry.unicode, glyphIndex: index })
    .filter((entry): entry is { code: number; glyphIndex: number } => entry !== undefined)
    .sort((a, b) => a.code - b.code);
  const bmpEntries = entries.filter((entry) => entry.code < 0xffff);
  // Format 4 reserves U+FFFF as its end-of-range sentinel. Use format 12
  // whenever U+FFFF or a non-BMP scalar is present so no valid scalar is lost.
  const hasFormat12 = entries.some((entry) => entry.code >= 0xffff);

  const format4Segments: { startCode: number; endCode: number; idDelta: number }[] = [];
  for (const entry of bmpEntries) {
    const previous = format4Segments[format4Segments.length - 1];
    const delta = (entry.glyphIndex - entry.code) & 0xffff;
    if (
      previous !== undefined &&
      previous.endCode + 1 === entry.code &&
      previous.idDelta === delta
    ) {
      previous.endCode = entry.code;
    } else {
      format4Segments.push({
        startCode: entry.code,
        endCode: entry.code,
        idDelta: delta,
      });
    }
  }

  const format4 = writer();
  const segmentCount = format4Segments.length + 1;
  const searchPower = 2 ** Math.floor(Math.log2(segmentCount));
  format4.u16(4);
  format4.u16(16 + segmentCount * 8);
  format4.u16(0);
  format4.u16(segmentCount * 2);
  format4.u16(searchPower * 2);
  format4.u16(Math.log2(searchPower));
  format4.u16(segmentCount * 2 - searchPower * 2);
  for (const seg of format4Segments) format4.u16(seg.endCode);
  format4.u16(0xffff);
  format4.u16(0);
  for (const seg of format4Segments) format4.u16(seg.startCode);
  format4.u16(0xffff);
  for (const seg of format4Segments) format4.u16(seg.idDelta);
  format4.u16(1);
  for (let index = 0; index < segmentCount; index += 1) format4.u16(0);

  const result = writer();
  result.u16(0);
  result.u16(hasFormat12 ? 2 : 1);
  result.u16(3);
  result.u16(1);
  // The first subtable follows the 4-byte cmap header and both 8-byte
  // encoding records whenever format 12 is present.
  result.u32(hasFormat12 ? 20 : 12);
  if (hasFormat12) {
    result.u16(3);
    result.u16(10);
    result.u32(12 + 8 + format4.bytes.length);
  }
  result.raw(format4.bytes);

  if (hasFormat12) {
    const groups: { start: number; end: number; glyphIndex: number }[] = [];
    // A format 12 subtable is a complete UCS-4 mapping. Some readers prefer
    // it over format 4, so it must also contain the BMP entries.
    for (const entry of entries) {
      const previous = groups[groups.length - 1];
      if (previous !== undefined
        && previous.end + 1 === entry.code
        && previous.glyphIndex + (previous.end - previous.start + 1) === entry.glyphIndex) {
        previous.end = entry.code;
      } else {
        groups.push({ start: entry.code, end: entry.code, glyphIndex: entry.glyphIndex });
      }
    }
    const format12 = writer();
    format12.u16(12);
    format12.u16(0);
    format12.u32(16 + groups.length * 12);
    format12.u32(0);
    format12.u32(groups.length);
    for (const group of groups) {
      format12.u32(group.start);
      format12.u32(group.end);
      format12.u32(group.glyphIndex);
    }
    result.raw(format12.bytes);
  }
  return result.bytes;
}

function makeHeadTable(
  options: TrueTypeFontOptions,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
): number[] {
  const result = writer();
  result.u32(0x00010000);
  result.u32(0x00010000);
  result.u32(0);
  result.u32(0x5f0f3cf5);
  result.u16(3);
  result.u16(toUint16(options.unitsPerEm, "unitsPerEm"));
  // Keep the low-level serializer deterministic as well as the public
  // pipeline. Callers can still provide an explicit Unix timestamp.
  const timestamp = Math.round((options.createdTimestamp ?? -2082844800) + 2082844800);
  result.u32(0);
  result.u32(timestamp);
  result.u32(0);
  result.u32(timestamp);
  result.i16(toInt16(bounds.xMin, "head xMin"));
  result.i16(toInt16(bounds.yMin, "head yMin"));
  result.i16(toInt16(bounds.xMax, "head xMax"));
  result.i16(toInt16(bounds.yMax, "head yMax"));
  result.u16(0);
  result.u16(3);
  result.i16(2);
  result.i16(1);
  result.i16(0);
  return result.bytes;
}

function makeHheaTable(
  options: TrueTypeFontOptions,
  glyphs: readonly FontGlyphData[],
): number[] {
  const advances = glyphs.map((entry) => entry.advanceWidth);
  const leftBearings = glyphs.map((entry) => entry.leftSideBearing);
  const rightBearings = glyphs.map((entry) => entry.advanceWidth - (entry.xMax ?? 0));
  const xMaxExtent = glyphs.length === 0
    ? 0
    : Math.max(...glyphs.map((entry) => entry.leftSideBearing + ((entry.xMax ?? 0) - entry.leftSideBearing)));

  const result = writer();
  result.u32(0x00010000);
  result.i16(toInt16(options.ascender, "ascender"));
  result.i16(toInt16(options.descender, "descender"));
  result.i16(toInt16(options.lineGap, "lineGap"));
  result.u16(Math.max(...advances, 0));
  result.i16(Math.min(...leftBearings, 0));
  result.i16(Math.min(...rightBearings, 0));
  result.i16(toInt16(xMaxExtent, "hhea xMaxExtent"));
  result.i16(1);
  result.i16(0);
  result.i16(0);
  result.i16(0);
  result.i16(0);
  result.i16(0);
  result.i16(0);
  result.i16(0);
  result.u16(glyphs.length);
  return result.bytes;
}

function makeHmtxTable(glyphs: readonly FontGlyphData[]): number[] {
  const result = writer();
  for (const entry of glyphs) {
    result.u16(toUint16(entry.advanceWidth, "advanceWidth"));
    result.i16(toInt16(entry.leftSideBearing, "leftSideBearing"));
  }
  return result.bytes;
}

function makeMaxpTable(glyphs: readonly TrueTypeGlyphData[]): number[] {
  const result = writer();
  result.u32(0x00010000);
  result.u16(glyphs.length);
  result.u16(Math.max(...glyphs.map((glyph) => glyph.points.length), 0));
  result.u16(Math.max(...glyphs.map((glyph) => glyph.contourCount), 0));
  result.u16(0);
  result.u16(0);
  result.u16(1);
  result.u16(0);
  result.u16(0);
  result.u16(0);
  result.u16(0);
  result.u16(0);
  result.u16(0);
  result.u16(0);
  result.u16(0);
  return result.bytes;
}

function makeOs2Table(
  options: TrueTypeFontOptions,
  glyphs: readonly FontGlyphData[],
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
): number[] {
  const unicode = glyphs.map((entry) => entry.unicode).filter((value): value is number => value !== undefined);
  const advances = glyphs.map((entry) => entry.advanceWidth);
  const result = writer();
  result.u16(3);
  result.i16(toInt16(advances.reduce((sum, value) => sum + value, 0) / Math.max(advances.length, 1), "xAvgCharWidth"));
  result.u16(toUint16(options.weightClass, "weightClass"));
  result.u16(5);
  result.u16(0);
  result.i16(650);
  result.i16(699);
  result.i16(0);
  result.i16(140);
  result.i16(650);
  result.i16(699);
  result.i16(0);
  result.i16(479);
  result.i16(64);
  result.i16(toInt16(options.underlinePosition, "sStrikeoutPosition"));
  result.i16(0);
  for (let index = 0; index < 10; index += 1) result.u8(0);
  result.u32(unicode.includes(0x0400) ? 0xa000000f : 0x00000001);
  result.u32(0);
  result.u32(0);
  result.u32(0);
  result.raw([0x58, 0x58, 0x58, 0x58]);
  result.u16(options.fsSelection);
  result.u16(unicode.length === 0 ? 0 : Math.min(Math.min(...unicode), 0xffff));
  result.u16(unicode.length === 0 ? 0 : Math.min(Math.max(...unicode), 0xffff));
  result.i16(toInt16(options.ascender, "sTypoAscender"));
  result.i16(toInt16(options.descender, "sTypoDescender"));
  result.i16(toInt16(options.lineGap, "sTypoLineGap"));
  result.u16(toUint16(Math.max(options.ascender, bounds.yMax, 0), "usWinAscent"));
  result.u16(toUint16(Math.max(-options.descender, -bounds.yMin, 0), "usWinDescent"));
  result.u32(1);
  result.u32(0);
  result.i16(0);
  result.i16(toInt16(options.ascender, "sCapHeight"));
  result.u16(0);
  result.u16(unicode.includes(32) ? 32 : 0);
  result.u16(0);
  return result.bytes;
}

function makePostTable(options: TrueTypeFontOptions): number[] {
  const result = writer();
  result.u32(0x00030000);
  result.i32(0);
  result.i16(toInt16(options.underlinePosition, "underlinePosition"));
  result.i16(toInt16(options.underlineThickness, "underlineThickness"));
  result.u32(0);
  result.u32(0);
  result.u32(0);
  result.u32(0);
  result.u32(0);
  return result.bytes;
}

function makeGlyfAndLoca(
  glyphs: readonly TrueTypeGlyphData[],
): { glyf: number[]; loca: number[] } {
  const glyf: number[] = [];
  const offsets: number[] = [0];
  for (const glyph of glyphs) {
    glyf.push(...glyph.bytes);
    while (glyf.length % 4 !== 0) glyf.push(0);
    offsets.push(glyf.length);
  }
  const loca = writer();
  for (const offset of offsets) loca.u32(offset);
  return { glyf, loca: loca.bytes };
}

function table(tag: string, bytes: readonly number[]): TableData {
  const padded = [...bytes];
  while (padded.length % 4 !== 0) padded.push(0);
  return { tag, bytes: padded, length: bytes.length };
}

function makeSfnt(tables: readonly TableData[]): ArrayBuffer {
  const ordered = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const numTables = ordered.length;
  const searchPower = 2 ** Math.floor(Math.log2(numTables));
  const searchRange = searchPower * 16;
  const header = writer();
  header.u32(0x00010000);
  header.u16(numTables);
  header.u16(searchRange);
  header.u16(Math.log2(searchPower));
  header.u16(numTables * 16 - searchRange);
  let offset = 12 + numTables * 16;
  const records: { table: TableData; offset: number; checksum: number; length: number }[] = [];
  for (const current of ordered) {
    records.push({ table: current, offset, checksum: checksum(current.bytes), length: current.length });
    offset += current.bytes.length;
  }
  const result = writer();
  result.raw(header.bytes);
  for (const record of records) {
    result.tag(record.table.tag);
    result.u32(record.checksum);
    result.u32(record.offset);
    result.u32(record.length);
  }
  for (const record of records) result.raw(record.table.bytes);

  const headRecord = records.find((record) => record.table.tag === "head");
  if (headRecord !== undefined) {
    const fullWithoutAdjustment = [...result.bytes];
    const headAdjustmentOffset = headRecord.offset + 8;
    fullWithoutAdjustment[headAdjustmentOffset] = 0;
    fullWithoutAdjustment[headAdjustmentOffset + 1] = 0;
    fullWithoutAdjustment[headAdjustmentOffset + 2] = 0;
    fullWithoutAdjustment[headAdjustmentOffset + 3] = 0;
    const adjustment = (0xb1b0afba - checksum(fullWithoutAdjustment)) >>> 0;
    result.bytes[headAdjustmentOffset] = (adjustment >>> 24) & 0xff;
    result.bytes[headAdjustmentOffset + 1] = (adjustment >>> 16) & 0xff;
    result.bytes[headAdjustmentOffset + 2] = (adjustment >>> 8) & 0xff;
    result.bytes[headAdjustmentOffset + 3] = adjustment & 0xff;
  }
  return new Uint8Array(result.bytes).buffer;
}

function glyphDataFromFont(font: Font): FontGlyphData[] {
  const result: FontGlyphData[] = [];
  for (let index = 0; index < font.glyphs.length; index += 1) {
    const glyph = font.glyphs.get(index);
    const box = glyph.getBoundingBox();
    const xMin = Number.isFinite(box.x1) ? box.x1 : 0;
    const xMax = Number.isFinite(box.x2) ? box.x2 : 0;
    result.push({
      glyph,
      unicode: glyph.unicode,
      advanceWidth: glyph.advanceWidth ?? 0,
      leftSideBearing: xMin,
      xMin,
      xMax,
      pathCommands: glyph.path.commands,
    });
  }
  return result;
}

function makeGsubTable(substitutions?: {
  readonly ss01?: readonly { readonly sub: number; readonly by: number }[];
  readonly ss02?: readonly { readonly sub: number; readonly by: number }[];
  readonly ss03?: readonly { readonly sub: number; readonly by: number }[];
}): number[] | undefined {
  if (!substitutions) return undefined;
  const features: { tag: string; subs: readonly { sub: number; by: number }[] }[] = [];
  if (substitutions.ss01 && substitutions.ss01.length > 0) features.push({ tag: "ss01", subs: substitutions.ss01 });
  if (substitutions.ss02 && substitutions.ss02.length > 0) features.push({ tag: "ss02", subs: substitutions.ss02 });
  if (substitutions.ss03 && substitutions.ss03.length > 0) features.push({ tag: "ss03", subs: substitutions.ss03 });
  if (features.length === 0) return undefined;

  const res = writer();
  res.u32(0x00010000);

  const scriptListOffset = 10;
  const scriptListSize = 8 + 4 + 6 + features.length * 2;
  const featureListOffset = scriptListOffset + scriptListSize;

  const featureListHeaderSize = 2 + features.length * 6;
  const featureOffsets: number[] = [];
  for (let i = 0; i < features.length; i++) {
    featureOffsets.push(featureListHeaderSize + i * 6);
  }
  const featureListSize = featureListHeaderSize + features.length * 6;

  const lookupListOffset = featureListOffset + featureListSize;

  const lookupHeaderSize = 2 + features.length * 2;
  const lookupOffsets: number[] = [];
  const lookupDataList: number[][] = [];
  let currentLookupDataOffset = lookupHeaderSize;

  for (let i = 0; i < features.length; i++) {
    lookupOffsets.push(currentLookupDataOffset);
    const subs = features[i]!.subs;
    const count = subs.length;
    const coverageOffset = 6 + 2 * count;

    const lWriter = writer();
    lWriter.u16(1);
    lWriter.u16(0);
    lWriter.u16(1);
    lWriter.u16(8);

    lWriter.u16(2);
    lWriter.u16(coverageOffset);
    lWriter.u16(count);
    for (const pair of subs) {
      lWriter.u16(pair.by);
    }

    lWriter.u16(1);
    lWriter.u16(count);
    for (const pair of subs) {
      lWriter.u16(pair.sub);
    }

    lookupDataList.push(lWriter.bytes);
    currentLookupDataOffset += lWriter.bytes.length;
  }

  res.u16(scriptListOffset);
  res.u16(featureListOffset);
  res.u16(lookupListOffset);

  res.u16(1);
  res.tag("DFLT");
  res.u16(8);
  res.u16(4);
  res.u16(0);
  res.u16(0);
  res.u16(0xffff);
  res.u16(features.length);
  for (let i = 0; i < features.length; i++) res.u16(i);

  res.u16(features.length);
  for (let i = 0; i < features.length; i++) {
    res.tag(features[i]!.tag);
    res.u16(featureOffsets[i]!);
  }
  for (let i = 0; i < features.length; i++) {
    res.u16(0);
    res.u16(1);
    res.u16(i);
  }

  res.u16(features.length);
  for (let i = 0; i < features.length; i++) res.u16(lookupOffsets[i]!);
  for (let i = 0; i < features.length; i++) res.raw(lookupDataList[i]!);

  return res.bytes;
}


/**
 * Writes a real TrueType sfnt from the paths held by an opentype.js Font.
 * Cubic commands are adaptively approximated by quadratic segments because
 * the TrueType glyf format has no cubic primitive; line and quadratic input is
 * retained directly. No CFF table is emitted.
 */
export function serializeTrueTypeFont(
  font: Font,
  options: TrueTypeFontOptions,
): ArrayBuffer {
  const allGlyphs = glyphDataFromFont(font);
  const glyphs = allGlyphs.length > 65535 ? allGlyphs.slice(0, 65535) : allGlyphs;
  const trueTypeGlyphs = glyphs.map((entry) => makeGlyphData(entry.pathCommands));
  const bounds = {
    xMin: Math.min(...trueTypeGlyphs.map((glyph) => glyph.xMin), 0),
    yMin: Math.min(...trueTypeGlyphs.map((glyph) => glyph.yMin), 0),
    xMax: Math.max(...trueTypeGlyphs.map((glyph) => glyph.xMax), 0),
    yMax: Math.max(...trueTypeGlyphs.map((glyph) => glyph.yMax), 0),
  };
  const { glyf, loca } = makeGlyfAndLoca(trueTypeGlyphs);
  const gsubData = makeGsubTable(options.substitutions);
  const tables = [
    table("OS/2", makeOs2Table(options, glyphs, bounds)),
    table("cmap", makeCmapTable(glyphs)),
    ...(gsubData ? [table("GSUB", gsubData)] : []),
    table("glyf", glyf),
    table("head", makeHeadTable(options, bounds)),
    table("hhea", makeHheaTable(options, glyphs)),
    table("hmtx", makeHmtxTable(glyphs)),
    table("loca", loca),
    table("maxp", makeMaxpTable(trueTypeGlyphs)),
    table("name", makeNameTable(options)),
    table("post", makePostTable(options)),
  ];
  return makeSfnt(tables);
}

/**
 * Serializes multiple TrueType fonts into a single TrueType Collection (.ttc) binary buffer.
 */
export function serializeTrueTypeCollection(
  fonts: readonly { font: Font; options: TrueTypeFontOptions }[],
): ArrayBuffer {
  const sfntBuffers = fonts.map(({ font, options }) =>
    new Uint8Array(serializeTrueTypeFont(font, options)),
  );
  const headerSize = 12 + fonts.length * 4;
  let offset = headerSize;
  const offsets: number[] = [];
  for (const buf of sfntBuffers) {
    offset = (offset + 3) & ~3;
    offsets.push(offset);
    offset += buf.length;
  }
  const header = writer();
  header.raw([0x74, 0x74, 0x63, 0x66]);
  header.u16(1);
  header.u16(0);
  header.u32(fonts.length);
  for (const fontOffset of offsets) header.u32(fontOffset);

  const totalLength = (offset + 3) & ~3;
  const result = new Uint8Array(totalLength);
  result.set(header.bytes, 0);

  for (let index = 0; index < sfntBuffers.length; index += 1) {
    const subfontOffset = offsets[index]!;
    const fontBuf = new Uint8Array(sfntBuffers[index]!);
    const numTables = (fontBuf[4]! << 8) | fontBuf[5]!;
    for (let t = 0; t < numTables; t += 1) {
      const entryOffset = 12 + t * 16;
      const originalTableOffset =
        ((fontBuf[entryOffset + 8]! << 24) >>> 0)
        + ((fontBuf[entryOffset + 9]! << 16) >>> 0)
        + ((fontBuf[entryOffset + 10]! << 8) >>> 0)
        + (fontBuf[entryOffset + 11]! >>> 0);
      const absoluteTableOffset = originalTableOffset + subfontOffset;
      fontBuf[entryOffset + 8] = (absoluteTableOffset >>> 24) & 0xff;
      fontBuf[entryOffset + 9] = (absoluteTableOffset >>> 16) & 0xff;
      fontBuf[entryOffset + 10] = (absoluteTableOffset >>> 8) & 0xff;
      fontBuf[entryOffset + 11] = absoluteTableOffset & 0xff;
    }
    result.set(fontBuf, subfontOffset);
  }
  return result.buffer;
}

