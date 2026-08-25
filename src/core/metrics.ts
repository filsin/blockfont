import {
  DEFAULT_COORDINATE_SCALE,
  asIntegerFontUnit,
  minecraftToFontUnits,
  type CoordinateScale,
  type FontUnit,
  type FontUnitInput,
  type IntegerFontUnit,
  type MinecraftUnitInput,
  type UnitsPerEm,
} from "./units";

/**
 * Metrics attached to a normalized glyph.
 *
 * All values are integer OpenType font units. `advance` is intentionally
 * independent from the visible contour bounds and controls where the next
 * character starts.
 */
export interface GlyphMetrics {
  readonly advance: IntegerFontUnit;
  readonly boldOffset: IntegerFontUnit;
  readonly bearingLeft: IntegerFontUnit;
  readonly bearingTop: IntegerFontUnit;
}

/** Names used by OpenType backends for the corresponding normalized values. */
export interface OpenTypeGlyphMetrics {
  readonly advanceWidth: IntegerFontUnit;
  readonly leftSideBearing: IntegerFontUnit;
}

/** Input form accepted before integer-grid validation. */
export interface GlyphMetricsInput {
  readonly advance: FontUnitInput;
  readonly boldOffset: FontUnitInput;
  readonly bearingLeft: FontUnitInput;
  readonly bearingTop: FontUnitInput;
}

/** Alias that makes the normalized/common representation explicit. */
export type MinecraftGlyphMetrics = GlyphMetrics;

/** Metrics as read from a Minecraft provider, before scale conversion. */
export interface MinecraftSourceGlyphMetrics {
  readonly advance: MinecraftUnitInput;
  readonly boldOffset: MinecraftUnitInput;
  readonly bearingLeft: MinecraftUnitInput;
  readonly bearingTop: MinecraftUnitInput;
}

/** Vertical metrics in the normalized OpenType coordinate convention. */
export interface FontVerticalMetrics {
  readonly unitsPerEm: UnitsPerEm;
  readonly baseline: IntegerFontUnit;
  readonly ascent: IntegerFontUnit;
  /** Signed OpenType convention: zero or negative below the baseline. */
  readonly descent: IntegerFontUnit;
  readonly lineGap: IntegerFontUnit;
}

/**
 * Font-wide vertical and underline metrics in OpenType units.
 *
 * The origin is the baseline, ascent is non-negative above it, and descent is
 * non-positive below it. The underline values use the same OpenType y-up
 * coordinate system.
 */
export interface FontMetrics extends FontVerticalMetrics {
  readonly underlinePosition: IntegerFontUnit;
  readonly underlineThickness: IntegerFontUnit;
}

/** Runtime-friendly input accepted by createFontMetrics. */
export interface FontMetricsInput {
  readonly unitsPerEm: UnitsPerEm;
  readonly baseline: FontUnitInput;
  readonly ascent: FontUnitInput;
  readonly descent: FontUnitInput;
  readonly lineGap: FontUnitInput;
  readonly underlinePosition: FontUnitInput;
  readonly underlineThickness: FontUnitInput;
}

/** Minecraft vertical metrics before conversion to OpenType. */
export interface MinecraftVerticalMetricsInput {
  /** Baseline y-coordinate in a positive-down Minecraft origin. */
  readonly baseline: MinecraftUnitInput;
  /** Positive distance above the baseline. */
  readonly ascent: MinecraftUnitInput;
  /** Positive distance below the baseline. */
  readonly descent: MinecraftUnitInput;
  /** Optional positive line gap distance. */
  readonly lineGap?: MinecraftUnitInput;
}

function assertNonNegative(value: number, name: string): void {
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

function assertNonPositive(value: number, name: string): void {
  if (value > 0) {
    throw new RangeError(`${name} must be non-positive`);
  }
}

/** Converts provider metrics into the common integer OpenType grid. */
export function minecraftGlyphMetricsToFontUnits(
  metrics: MinecraftSourceGlyphMetrics,
  scale: CoordinateScale = DEFAULT_COORDINATE_SCALE,
): GlyphMetrics {
  return {
    advance: asIntegerFontUnit(
      minecraftToFontUnits(metrics.advance, scale),
      "Glyph advance",
    ),
    boldOffset: asIntegerFontUnit(
      minecraftToFontUnits(metrics.boldOffset, scale),
      "Glyph boldOffset",
    ),
    bearingLeft: asIntegerFontUnit(
      minecraftToFontUnits(metrics.bearingLeft, scale),
      "Glyph bearingLeft",
    ),
    bearingTop: asIntegerFontUnit(
      minecraftToFontUnits(metrics.bearingTop, scale),
      "Glyph bearingTop",
    ),
  };
}

/** Short alias for provider adapters. */
export const convertMinecraftGlyphMetrics =
  minecraftGlyphMetricsToFontUnits;

/** Validates and copies normalized glyph metrics. */
export function createGlyphMetrics(metrics: GlyphMetricsInput): GlyphMetrics {
  const advance = asIntegerFontUnit(metrics.advance, "Glyph advance");
  const boldOffset = asIntegerFontUnit(
    metrics.boldOffset,
    "Glyph boldOffset",
  );
  const bearingLeft = asIntegerFontUnit(
    metrics.bearingLeft,
    "Glyph bearingLeft",
  );
  const bearingTop = asIntegerFontUnit(
    metrics.bearingTop,
    "Glyph bearingTop",
  );

  assertNonNegative(advance, "Glyph advance");
  assertNonNegative(boldOffset, "Glyph boldOffset");

  return Object.freeze({
    advance,
    boldOffset,
    bearingLeft,
    bearingTop,
  });
}

/** Maps the explicit common metrics to backend terminology without inference. */
export function glyphMetricsToOpenType(
  metrics: GlyphMetrics,
): OpenTypeGlyphMetrics {
  return {
    advanceWidth: metrics.advance,
    leftSideBearing: metrics.bearingLeft,
  };
}

/**
 * Converts Minecraft's positive-down vertical distances to OpenType's
 * baseline/y-up convention. No rounding is performed: non-grid values fail
 * at the explicit integer boundary.
 */
export function minecraftVerticalMetricsToOpenType(
  metrics: MinecraftVerticalMetricsInput,
  scale: CoordinateScale = DEFAULT_COORDINATE_SCALE,
): FontVerticalMetrics {
  const lineGap = metrics.lineGap ?? 0;
  assertNonNegative(metrics.ascent, "Minecraft ascent");
  assertNonNegative(metrics.descent, "Minecraft descent");
  assertNonNegative(lineGap, "Minecraft lineGap");
  asIntegerFontUnit(
    minecraftToFontUnits(metrics.baseline, scale),
    "Minecraft source baseline",
  );

  return Object.freeze({
    unitsPerEm: scale.unitsPerEm,
    // The source baseline is used only to validate/source-place geometry;
    // normalized font metrics always use baseline zero.
    baseline: asIntegerFontUnit(0, "Font baseline"),
    ascent: asIntegerFontUnit(
      minecraftToFontUnits(metrics.ascent, scale),
      "Font ascent",
    ),
    descent: asIntegerFontUnit(
      -minecraftToFontUnits(metrics.descent, scale),
      "Font descent",
    ),
    lineGap: asIntegerFontUnit(
      minecraftToFontUnits(lineGap, scale),
      "Font lineGap",
    ),
  });
}

/** Alias for callers that use the more general conversion terminology. */
export const convertMinecraftVerticalMetrics =
  minecraftVerticalMetricsToOpenType;

/** Validates and copies font-wide metrics without inferring them from glyphs. */
export function createFontMetrics(metrics: FontMetricsInput): FontMetrics {
  if (!Number.isSafeInteger(metrics.unitsPerEm) || metrics.unitsPerEm <= 0) {
    throw new RangeError("Font unitsPerEm must be a positive safe integer");
  }

  const baseline = asIntegerFontUnit(metrics.baseline, "Font baseline");
  const ascent = asIntegerFontUnit(metrics.ascent, "Font ascent");
  const descent = asIntegerFontUnit(metrics.descent, "Font descent");
  const lineGap = asIntegerFontUnit(metrics.lineGap, "Font lineGap");
  const underlinePosition = asIntegerFontUnit(
    metrics.underlinePosition,
    "Font underlinePosition",
  );
  const underlineThickness = asIntegerFontUnit(
    metrics.underlineThickness,
    "Font underlineThickness",
  );

  if (baseline !== 0) {
    throw new RangeError("Normalized font baseline must be zero");
  }

  assertNonNegative(ascent, "Font ascent");
  assertNonPositive(descent, "Font descent");
  assertNonNegative(lineGap, "Font lineGap");
  assertNonNegative(underlineThickness, "Font underlineThickness");

  return Object.freeze({
    unitsPerEm: metrics.unitsPerEm,
    baseline,
    ascent,
    descent,
    lineGap,
    underlinePosition,
    underlineThickness,
  });
}
