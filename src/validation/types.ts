import type {
  FontFormat,
  FontStyle,
  MinecraftGlyph,
} from "../core";
import type {
  BlockFontGenerationResult,
  BlockFontOutputFile,
} from "../pipeline";

export type FontBinary = Uint8Array | ArrayBuffer;

export interface UnderlineExpectation {
  readonly position: number;
  readonly thickness: number;
}

export interface VerticalMetricsExpectation {
  readonly unitsPerEm?: number;
  readonly ascender?: number;
  readonly descender?: number;
  /** Checked only when the reparsed font exposes a BASE/baseline value. */
  readonly baseline?: number;
  readonly lineGap?: number;
}

export interface FontValidationOptions {
  readonly expectedCodepoints?: Iterable<number> | string;
  readonly expectedAdvances?: ReadonlyMap<number, number> | Readonly<Record<string, number>>;
  readonly expectedFormat?: FontFormat;
  readonly expectedStyle?: FontStyle;
  readonly verticalMetrics?: VerticalMetricsExpectation;
  readonly underline?: UnderlineExpectation;
  readonly requireUnderline?: boolean;
  readonly requireExactCodepointSet?: boolean;
}

export type ValidationIssueCode =
  | "parse-error"
  | "format-mismatch"
  | "style-mismatch"
  | "missing-codepoint"
  | "unexpected-codepoint"
  | "duplicate-codepoint"
  | "advance-mismatch"
  | "vertical-metric-mismatch"
  | "underline-missing"
  | "underline-mismatch"
  | "style-missing"
  | "file-missing"
  | "file-name-mismatch"
  | "binary-mismatch"
  | "structure-mismatch";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly message: string;
  readonly codepoint?: number;
  readonly field?: string;
  readonly fileName?: string;
}

export interface ParsedFontSummary {
  readonly format: FontFormat | "unknown";
  readonly unitsPerEm: number | undefined;
  readonly ascender: number | undefined;
  readonly descender: number | undefined;
  readonly lineGap: number | undefined;
  readonly baseline: number | undefined;
  readonly underlinePosition: number | undefined;
  readonly underlineThickness: number | undefined;
  readonly styleName: string | undefined;
  readonly codepoints: readonly number[];
  readonly advances: ReadonlyMap<number, number>;
}

export interface FontValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly summary: ParsedFontSummary | undefined;
}

export interface GeneratedFontsValidationOptions extends FontValidationOptions {
  readonly requireAllStyles?: boolean;
  readonly expectedStyles?: readonly FontStyle[];
  readonly expectedFormats?: readonly FontFormat[];
}

export interface GeneratedFontsValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly files: readonly FontValidationReport[];
}

export interface ReproducibilityReport {
  readonly valid: boolean;
  readonly mode: "binary" | "structural" | "mismatch";
  readonly issues: readonly ValidationIssue[];
}

export interface GeneratedFontSetLike {
  readonly files: readonly BlockFontOutputFile[];
  readonly styles?: readonly FontStyle[];
  readonly formats?: readonly FontFormat[];
  readonly codepoints?: readonly number[];
  readonly glyphs?: readonly MinecraftGlyph[];
}

export type GeneratedFontValidationInput =
  | GeneratedFontSetLike
  | BlockFontGenerationResult;
