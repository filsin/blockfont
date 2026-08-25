import {
  createGlyphMetrics,
  type GlyphMetrics,
  type GlyphMetricsInput,
} from "./metrics";
import {
  normalizeContour,
  validateContour,
  getContoursBounds,
  getVisibleMetrics,
  type BoundingBox,
  type Contour,
  type ContourInput,
  NON_ZERO_FILL_RULE,
  type FillRule,
  type VisibleMetrics,
} from "./contour";
import {
  NORMALIZED_FONT_COORDINATE_SYSTEM,
  asFontUnit,
  type FontCoordinateSystem,
} from "./units";

/** The largest Unicode scalar value accepted by the core model. */
export const MAX_UNICODE_CODEPOINT = 0x10ffff;

/**
 * Provider-independent intermediate representation used by every later
 * pipeline stage.
 *
 * Contours and metrics are already expressed in integer OpenType units. The
 * `advance` field remains an explicit metric and is never inferred from the
 * visible geometry.
 */
export interface MinecraftGlyph {
  readonly codepoint: number;
  readonly contours: readonly Contour[];
  /** Explicit visible bounds; undefined is the valid value for whitespace. */
  readonly bounds: BoundingBox | undefined;
  /** OpenType non-zero fill; contour winding describes holes. */
  readonly fillRule: FillRule;
  readonly metrics: GlyphMetrics;
  readonly coordinateSystem: Readonly<FontCoordinateSystem>;
}

export interface MinecraftGlyphInput {
  readonly codepoint: number;
  readonly contours: readonly ContourInput[];
  readonly metrics: GlyphMetricsInput;
}

function assertValidCodepoint(codepoint: number): void {
  if (
    !Number.isInteger(codepoint) ||
    codepoint < 0 ||
    codepoint > MAX_UNICODE_CODEPOINT ||
    (codepoint >= 0xd800 && codepoint <= 0xdfff)
  ) {
    throw new RangeError(
      `Glyph codepoint must be a Unicode scalar value: ${codepoint}`,
    );
  }
}

/**
 * Creates a deeply normalized glyph and defensively copies its input.
 * No metric is derived from contours; in particular, a visible overflow does
 * not alter `metrics.advance`.
 */
export function createMinecraftGlyph(
  input: MinecraftGlyphInput,
): MinecraftGlyph {
  assertValidCodepoint(input.codepoint);
  const contours = input.contours.map((contour) => {
    const normalized = normalizeContour(contour);
    validateContour(normalized, { requireClosed: true });
    return normalized;
  });
  const bounds = getContoursBounds(contours);

  const glyph: MinecraftGlyph = {
    codepoint: input.codepoint,
    contours: Object.freeze(contours),
    bounds,
    fillRule: NON_ZERO_FILL_RULE,
    metrics: createGlyphMetrics(input.metrics),
    coordinateSystem: NORMALIZED_FONT_COORDINATE_SYSTEM,
  };

  return Object.freeze(glyph);
}

/** Returns visible bounds without confusing them with advance width. */
export function getGlyphBounds(
  glyph: Pick<MinecraftGlyph, "bounds"> | Pick<MinecraftGlyph, "contours">,
): BoundingBox | undefined {
  if ("bounds" in glyph) {
    return glyph.bounds;
  }
  return getContoursBounds(glyph.contours);
}

/** Returns visible dimensions derived from contours only. */
export function getGlyphVisibleMetrics(
  glyph: Pick<MinecraftGlyph, "bounds"> | Pick<MinecraftGlyph, "contours">,
): VisibleMetrics {
  if ("bounds" in glyph) {
    if (glyph.bounds === undefined) {
      return getVisibleMetrics([]);
    }
    return {
      width: asFontUnit(glyph.bounds.xMax - glyph.bounds.xMin),
      height: asFontUnit(glyph.bounds.yMax - glyph.bounds.yMin),
    };
  }
  return getVisibleMetrics(glyph.contours);
}
