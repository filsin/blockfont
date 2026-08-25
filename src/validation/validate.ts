import { readFile } from "node:fs/promises";

import { parse, type Font } from "opentype.js";

import type {
  FontFormat,
  FontStyle,
  MinecraftGlyph,
} from "../core";
import type {
  BlockFontOutputFile,
} from "../pipeline";
import { BlockFontValidationError } from "./errors";
import type {
  FontBinary,
  FontValidationOptions,
  FontValidationReport,
  GeneratedFontSetLike,
  GeneratedFontsValidationOptions,
  GeneratedFontsValidationReport,
  ParsedFontSummary,
  ReproducibilityReport,
  UnderlineExpectation,
  ValidationIssue,
  VerticalMetricsExpectation,
} from "./types";

const MAX_UNICODE = 0x10ffff;

function isUnicodeScalar(value: number): boolean {
  return Number.isInteger(value)
    && value >= 0
    && value <= MAX_UNICODE
    && !(value >= 0xd800 && value <= 0xdfff);
}

function codepointLabel(codepoint: number): string {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function bytesForParse(input: FontBinary): ArrayBuffer {
  if (input instanceof Uint8Array) return new Uint8Array(input).buffer;
  return input.slice(0);
}

function detectFormat(bytes: Uint8Array): FontFormat | "unknown" {
  if (bytes.length >= 4
    && bytes[0] === 0x77
    && bytes[1] === 0x4f
    && bytes[2] === 0x46
    && bytes[3] === 0x46) return "woff";
  if (bytes.length >= 4
    && bytes[0] === 0x4f
    && bytes[1] === 0x54
    && bytes[2] === 0x54
    && bytes[3] === 0x4f) return "otf";
  if (bytes.length >= 4
    && bytes[0] === 0x00
    && bytes[1] === 0x01
    && bytes[2] === 0x00
    && bytes[3] === 0x00) return "ttf";
  if (bytes.length >= 4
    && bytes[0] === 0x74
    && bytes[1] === 0x72
    && bytes[2] === 0x75
    && bytes[3] === 0x65) return "ttf";
  return "unknown";
}

function styleLabel(style: FontStyle): string {
  switch (style) {
    case "regular": return "Regular";
    case "bold": return "Bold";
    case "italic": return "Italic";
    case "boldItalic": return "Bold Italic";
  }
}

function styleFileLabel(style: FontStyle): string {
  if (style === "boldItalic") return "BoldItalic";
  return styleLabel(style);
}


function normalizeCodepoints(input: Iterable<number> | string | undefined): readonly number[] {
  if (input === undefined) return Object.freeze([]);
  const values = typeof input === "string"
    ? Array.from(input, (character) => character.codePointAt(0) as number)
    : [...input];
  const result = new Set<number>();
  for (const value of values) {
    if (!isUnicodeScalar(value)) {
      throw new RangeError(`Invalid expected codepoint: ${value}`);
    }
    result.add(value);
  }
  return Object.freeze([...result].sort((left, right) => left - right));
}

function codepointFromKey(key: string): number | undefined {
  const trimmed = key.trim();
  if (Array.from(trimmed).length === 1) return trimmed.codePointAt(0);
  if (/^U\+[0-9a-f]+$/i.test(trimmed)) {
    const codepoint = Number.parseInt(trimmed.slice(2), 16);
    return isUnicodeScalar(codepoint) ? codepoint : undefined;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    const codepoint = Number.parseInt(trimmed, 10);
    return isUnicodeScalar(codepoint) ? codepoint : undefined;
  }
  return undefined;
}

function normalizeAdvances(
  input: ReadonlyMap<number, number> | Readonly<Record<string, number>> | undefined,
): ReadonlyMap<number, number> {
  if (input === undefined) return new Map();
  const result = new Map<number, number>();
  if (input instanceof Map) {
    for (const [codepoint, advance] of input) result.set(codepoint, advance);
  } else {
    for (const [key, advance] of Object.entries(input)) {
      const codepoint = codepointFromKey(key);
      if (codepoint !== undefined) result.set(codepoint, advance);
    }
  }
  return result;
}

function getEnglishName(font: Font, name: string): string | undefined {
  try {
    const value = font.getEnglishName(name);
    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

function readBaseline(font: Font): number | undefined {
  const base = font.tables.base as unknown;
  if (typeof base !== "object" || base === null) return undefined;
  if ("baseline" in base && typeof base.baseline === "number") return base.baseline;
  if ("baselineY" in base && typeof base.baselineY === "number") return base.baselineY;
  return undefined;
}

function makeSummary(font: Font, bytes: Uint8Array): ParsedFontSummary {
  const codepoints: number[] = [];
  const advances = new Map<number, number>();
  const seen = new Set<number>();
  for (let index = 0; index < font.glyphs.length; index += 1) {
    const glyph = font.glyphs.get(index);
    for (const codepoint of glyph.unicodes) {
      if (seen.has(codepoint)) continue;
      seen.add(codepoint);
      codepoints.push(codepoint);
      advances.set(codepoint, glyph.advanceWidth ?? 0);
    }
  }
  codepoints.sort((left, right) => left - right);
  const post = font.tables.post as {
    underlinePosition?: number;
    underlineThickness?: number;
  } | undefined;
  const hhea = font.tables.hhea as { lineGap?: number } | undefined;
  return Object.freeze({
    format: detectFormat(bytes),
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    lineGap: hhea?.lineGap,
    baseline: readBaseline(font),
    underlinePosition: post?.underlinePosition,
    underlineThickness: post?.underlineThickness,
    styleName: getEnglishName(font, "fontSubfamily"),
    codepoints: Object.freeze(codepoints),
    advances,
  });
}

function issue(
  code: ValidationIssue["code"],
  message: string,
  extras: Omit<ValidationIssue, "code" | "message"> = {},
): ValidationIssue {
  return Object.freeze({ code, message, ...extras });
}

function compareNumber(
  issues: ValidationIssue[],
  actual: number | undefined,
  expected: number | undefined,
  field: string,
  code: ValidationIssue["code"],
  fileName?: string,
): void {
  if (expected === undefined) return;
  if (actual === undefined || actual !== expected) {
    issues.push(issue(
      code,
      `${field} mismatch: expected ${expected}, got ${actual ?? "not exposed"}`,
      { field, ...(fileName === undefined ? {} : { fileName }) },
    ));
  }
}

function compareVerticalMetrics(
  issues: ValidationIssue[],
  summary: ParsedFontSummary,
  expected: VerticalMetricsExpectation | undefined,
  fileName?: string,
): void {
  if (expected === undefined) return;
  compareNumber(issues, summary.unitsPerEm, expected.unitsPerEm, "unitsPerEm", "vertical-metric-mismatch", fileName);
  compareNumber(issues, summary.ascender, expected.ascender, "ascender", "vertical-metric-mismatch", fileName);
  compareNumber(issues, summary.descender, expected.descender, "descender", "vertical-metric-mismatch", fileName);
  compareNumber(issues, summary.lineGap, expected.lineGap, "lineGap", "vertical-metric-mismatch", fileName);
  // BASE/baseline is optional in the current exporter. Only compare it when
  // the parsed font actually exposes a value.
  if (expected.baseline !== undefined && summary.baseline !== undefined) {
    compareNumber(issues, summary.baseline, expected.baseline, "baseline", "vertical-metric-mismatch", fileName);
  }
}

function compareUnderline(
  issues: ValidationIssue[],
  summary: ParsedFontSummary,
  expected: UnderlineExpectation | undefined,
  requireUnderline: boolean,
  fileName?: string,
): void {
  if (summary.underlinePosition === undefined || summary.underlineThickness === undefined) {
    if (requireUnderline || expected !== undefined) {
      issues.push(issue(
        "underline-missing",
        "The parsed font does not expose OpenType underline metrics",
        fileName === undefined ? {} : { fileName },
      ));
    }
    return;
  }
  if (expected === undefined) return;
  compareNumber(issues, summary.underlinePosition, expected.position, "underlinePosition", "underline-mismatch", fileName);
  compareNumber(issues, summary.underlineThickness, expected.thickness, "underlineThickness", "underline-mismatch", fileName);
}

function compareCodepoints(
  issues: ValidationIssue[],
  summary: ParsedFontSummary,
  expected: readonly number[],
  exact: boolean,
  fileName?: string,
): void {
  const actual = new Set(summary.codepoints);
  for (const codepoint of expected) {
    if (!actual.has(codepoint)) {
      issues.push(issue(
        "missing-codepoint",
        `Missing codepoint ${codepointLabel(codepoint)}`,
        { codepoint, ...(fileName === undefined ? {} : { fileName }) },
      ));
    }
  }
  if (exact) {
    for (const codepoint of summary.codepoints) {
      if (!expected.includes(codepoint)) {
        issues.push(issue(
          "unexpected-codepoint",
          `Unexpected codepoint ${codepointLabel(codepoint)}`,
          { codepoint, ...(fileName === undefined ? {} : { fileName }) },
        ));
      }
    }
  }
}

function compareAdvances(
  issues: ValidationIssue[],
  summary: ParsedFontSummary,
  expected: ReadonlyMap<number, number>,
  fileName?: string,
): void {
  for (const [codepoint, expectedAdvance] of expected) {
    const actual = summary.advances.get(codepoint);
    if (actual === undefined || actual !== expectedAdvance) {
      issues.push(issue(
        "advance-mismatch",
        `Advance mismatch for ${codepointLabel(codepoint)}: expected ${expectedAdvance}, got ${actual ?? "missing"}`,
        { codepoint, field: "advanceWidth", ...(fileName === undefined ? {} : { fileName }) },
      ));
    }
  }
}

function parseFont(input: FontBinary): { font: Font; bytes: Uint8Array } {
  const bytes = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input.slice(0));
  return { font: parse(bytesForParse(bytes)), bytes };
}

/** Reparses and validates one TTF/OTF binary. It never mutates the input. */
export function validateFontFile(
  input: FontBinary,
  options: FontValidationOptions = {},
): FontValidationReport {
  const issues: ValidationIssue[] = [];
  let parsed: { font: Font; bytes: Uint8Array };
  try {
    parsed = parseFont(input);
  } catch (error) {
    return Object.freeze({
      valid: false,
      issues: Object.freeze([issue(
        "parse-error",
        `Unable to parse OpenType font: ${error instanceof Error ? error.message : String(error)}`,
      )]),
      summary: undefined,
    });
  }
  const summary = makeSummary(parsed.font, parsed.bytes);
  const expectedCodepoints = normalizeCodepoints(options.expectedCodepoints);
  compareCodepoints(
    issues,
    summary,
    expectedCodepoints,
    options.requireExactCodepointSet ?? false,
  );
  compareAdvances(issues, summary, normalizeAdvances(options.expectedAdvances));
  if (options.expectedFormat !== undefined && summary.format !== options.expectedFormat) {
    issues.push(issue(
      "format-mismatch",
      `Format mismatch: expected ${options.expectedFormat}, got ${summary.format}`,
      { field: "format" },
    ));
  }
  if (options.expectedStyle !== undefined) {
    const expectedStyle = styleLabel(options.expectedStyle);
    if (summary.styleName?.toLowerCase() !== expectedStyle.toLowerCase()) {
      issues.push(issue(
        "style-mismatch",
        `Style mismatch: expected ${expectedStyle}, got ${summary.styleName ?? "not exposed"}`,
        { field: "fontSubfamily" },
      ));
    }
  }
  compareVerticalMetrics(issues, summary, options.verticalMetrics);
  compareUnderline(
    issues,
    summary,
    options.underline,
    options.requireUnderline ?? false,
  );
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    summary,
  });
}

/** Validates a font file on disk. */
export async function validateFontFilePath(
  path: string,
  options: FontValidationOptions = {},
): Promise<FontValidationReport> {
  return validateFontFile(new Uint8Array(await readFile(path)), options);
}

function expectedAdvancesForStyle(
  glyphs: readonly MinecraftGlyph[] | undefined,
  style: FontStyle,
): ReadonlyMap<number, number> | undefined {
  if (glyphs === undefined) return undefined;
  const result = new Map<number, number>();
  for (const glyph of glyphs) {
    const bold = style === "bold" || style === "boldItalic";
    result.set(
      glyph.codepoint,
      glyph.metrics.advance + (bold ? glyph.metrics.boldOffset : 0),
    );
  }
  return result;
}

function issueForFile(
  item: ValidationIssue,
  fileName: string,
): ValidationIssue {
  return Object.freeze({ ...item, fileName: item.fileName ?? fileName });
}

function expectedUnderlineForUnits(unitsPerEm: number): UnderlineExpectation {
  const pixel = unitsPerEm / 16;
  return Object.freeze({ position: -1 * pixel, thickness: pixel });
}

/** Validates all files returned by generateBlockFont. */
export function validateGeneratedFonts(
  generated: GeneratedFontSetLike,
  options: GeneratedFontsValidationOptions = {},
): GeneratedFontsValidationReport {
  const issues: ValidationIssue[] = [];
  const reports: FontValidationReport[] = [];
  const expectedCodepoints = options.expectedCodepoints ?? generated.codepoints;
  const expectedStyles = options.expectedStyles
    ?? generated.styles
    ?? Object.freeze(["regular", "bold", "italic", "boldItalic"] as const);
  const expectedFormats = options.expectedFormats ?? generated.formats;
  const requiredAllStyles = options.requireAllStyles ?? false;
  const stylesPresent = new Set<FontStyle>();
  const formatsPresent = new Set<FontFormat>();

  for (const file of generated.files) {
    stylesPresent.add(file.style);
    formatsPresent.add(file.format);
    const unitsPerEm = options.verticalMetrics?.unitsPerEm ?? 2048;
    const verticalMetrics = options.verticalMetrics ?? {
      unitsPerEm,
      ascender: 9 * (unitsPerEm / 16),
      descender: -2 * (unitsPerEm / 16),
    };
    const underline = options.underline ?? expectedUnderlineForUnits(unitsPerEm);
    const expectedAdvances = options.expectedAdvances
      ?? expectedAdvancesForStyle(generated.glyphs, file.style);
    const fileOptions: FontValidationOptions = {
      ...(expectedCodepoints === undefined ? {} : { expectedCodepoints }),
      ...(expectedAdvances === undefined ? {} : { expectedAdvances }),
      expectedFormat: options.expectedFormat ?? file.format,
      expectedStyle: options.expectedStyle ?? file.style,
      verticalMetrics,
      underline,
      requireUnderline: options.requireUnderline ?? true,
      ...(options.requireExactCodepointSet === undefined
        ? {}
        : { requireExactCodepointSet: options.requireExactCodepointSet }),
    };
    const report = validateFontFile(file.bytes, fileOptions);
    reports.push(report);
    for (const item of report.issues) issues.push(issueForFile(item, file.fileName));
    const expectedName = `BlockFont-${styleFileLabel(file.style)}.${file.format}`;
    if (file.fileName !== expectedName) {
      issues.push(issue(
        "file-name-mismatch",
        `Unexpected generated file name: expected ${expectedName}, got ${file.fileName}`,
        { fileName: file.fileName },
      ));
    }
  }

  for (const style of expectedStyles) {
    if (requiredAllStyles && !stylesPresent.has(style)) {
      issues.push(issue("style-missing", `Missing generated style: ${styleLabel(style)}`));
    }
  }
  if (expectedFormats !== undefined) {
    for (const format of expectedFormats) {
      if (!formatsPresent.has(format)) {
        issues.push(issue("file-missing", `Missing generated format: ${format}`));
      }
    }
  }
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    files: Object.freeze(reports),
  });
}

/** Throws BlockFontValidationError when one or more generated files are invalid. */
export function assertValidGeneratedFonts(
  generated: GeneratedFontSetLike,
  options: GeneratedFontsValidationOptions = {},
): GeneratedFontsValidationReport {
  const report = validateGeneratedFonts(generated, options);
  if (!report.valid) {
    throw new BlockFontValidationError(
      report.issues.map((item) => item.message).join("; "),
      report.issues,
    );
  }
  return report;
}

/** Throws BlockFontValidationError when one binary is invalid. */
export function assertValidFontFile(
  input: FontBinary,
  options: FontValidationOptions = {},
): FontValidationReport {
  const report = validateFontFile(input, options);
  if (!report.valid) {
    throw new BlockFontValidationError(
      report.issues.map((item) => item.message).join("; "),
      report.issues,
    );
  }
  return report;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function fileKey(file: BlockFontOutputFile): string {
  return `${file.style}:${file.format}:${file.fileName}`;
}

/** Checks byte identity first, then reparsed structure when bytes differ. */
export function validateReproducibility(
  first: GeneratedFontSetLike,
  second: GeneratedFontSetLike,
): ReproducibilityReport {
  const issues: ValidationIssue[] = [];
  const secondByKey = new Map(second.files.map((file) => [fileKey(file), file]));
  let binary = true;
  let structural = true;
  for (const file of first.files) {
    const other = secondByKey.get(fileKey(file));
    if (other === undefined) {
      structural = false;
      issues.push(issue("file-missing", `Missing counterpart for ${file.fileName}`, { fileName: file.fileName }));
      continue;
    }
    if (sameBytes(file.bytes, other.bytes)) continue;
    binary = false;
    const left = validateFontFile(file.bytes);
    const right = validateFontFile(other.bytes);
    if (!left.valid || !right.valid
      || left.summary?.format !== right.summary?.format
      || left.summary?.codepoints.join(",") !== right.summary?.codepoints.join(",")
      || [...(left.summary?.advances.entries() ?? [])].some(([codepoint, advance]) =>
        right.summary?.advances.get(codepoint) !== advance)) {
      structural = false;
      issues.push(issue("structure-mismatch", `Structural mismatch for ${file.fileName}`, { fileName: file.fileName }));
    }
  }
  if (first.files.length !== second.files.length) {
    structural = false;
    issues.push(issue("file-missing", "Generated file sets have different sizes"));
  }
  if (binary) return Object.freeze({ valid: true, mode: "binary", issues: Object.freeze([]) });
  if (structural) return Object.freeze({ valid: true, mode: "structural", issues: Object.freeze([]) });
  return Object.freeze({ valid: false, mode: "mismatch", issues: Object.freeze(issues) });
}

export function assertReproducible(
  first: GeneratedFontSetLike,
  second: GeneratedFontSetLike,
): ReproducibilityReport {
  const report = validateReproducibility(first, second);
  if (!report.valid) {
    throw new BlockFontValidationError(
      report.issues.map((item) => item.message).join("; "),
      report.issues,
    );
  }
  return report;
}

export const validateGeneratedFont = validateFontFile;
export const validateBlockFontGeneration = validateGeneratedFonts;
