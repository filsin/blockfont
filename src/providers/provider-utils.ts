import {
  createLineContour,
  createMinecraftGlyph,
  minecraftGlyphMetricsToFontUnits,
  type Contour,
  type MinecraftGlyph,
  type CoordinateScale,
} from "../core";
import {
  minecraftRelativeYToOpenTypeY,
  minecraftToFontUnits,
} from "../core/units";
import type { AssetStore } from "../assets";
import type { CommonProviderDefinition } from "./font-definition";
import { InvalidProviderError } from "./errors";

export interface ProviderContext {
  readonly version: string;
  readonly store: AssetStore;
  readonly scale: Readonly<CoordinateScale>;
  readonly resolveFontGlyph: (
    fontId: string,
    codepoint: number,
    stack?: readonly string[],
  ) => Promise<MinecraftGlyph | undefined>;
}

export interface GlyphProvider {
  readonly type: string;
  resolve(
    codepoint: number,
    stack?: readonly string[],
  ): Promise<MinecraftGlyph | undefined>;
}

export interface SourceGlyphMetrics {
  readonly advance: number;
  readonly boldOffset: number;
  readonly bearingLeft: number;
  readonly bearingTop: number;
}

export function assertUnicodeScalar(codepoint: number): void {
  if (
    !Number.isInteger(codepoint) ||
    codepoint < 0 ||
    codepoint > 0x10ffff ||
    (codepoint >= 0xd800 && codepoint <= 0xdfff)
  ) {
    throw new RangeError(`Provider codepoint must be a Unicode scalar value: ${codepoint}`);
  }
}

export function codepointCharacter(codepoint: number): string {
  assertUnicodeScalar(codepoint);
  return String.fromCodePoint(codepoint);
}

/** Supports JSON maps keyed by characters, decimal codepoints, or U+XXXX. */
export function lookupProviderNumber(
  definition: CommonProviderDefinition,
  codepoint: number,
  property: "advance" | "boldOffset" | "bearingLeft" | "bearingTop",
  fallback: number,
): number {
  const key = codepointCharacter(codepoint);
  const mapValue = definition.advances?.[key]
    ?? definition.advances?.[String(codepoint)]
    ?? definition.advances?.[`U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`]
    ?? definition.advances?.[codepoint.toString(16).toUpperCase()];
  if (property === "advance" && mapValue !== undefined) return mapValue;
  if (property === "boldOffset" && definition.boldOffset !== undefined) return definition.boldOffset;
  if (property === "advance" && definition.advance !== undefined) return definition.advance;
  if (property === "bearingLeft" && definition.bearingLeft !== undefined) return definition.bearingLeft;
  if (property === "bearingTop" && definition.bearingTop !== undefined) return definition.bearingTop;
  return fallback;
}

/** Looks up a codepoint-keyed provider map using the supported JSON spellings. */
export function lookupCodepointMapNumber(
  values: Readonly<Record<string, number>>,
  codepoint: number,
): number | undefined {
  const character = codepointCharacter(codepoint);
  const hex = codepoint.toString(16).toUpperCase();
  return values[character]
    ?? values[String(codepoint)]
    ?? values[`U+${hex.padStart(4, "0")}`]
    ?? values[hex]
    ?? values[hex.padStart(4, "0")];
}

export function toFontCoordinate(
  value: number,
  context: ProviderContext,
  name: string,
): number {
  const converted = minecraftToFontUnits(value, context.scale);
  if (!Number.isSafeInteger(converted)) {
    throw new InvalidProviderError(
      `${name}=${value} cannot be represented on the configured OpenType grid`,
    );
  }
  return converted;
}

/** Creates a rectangle for one active source pixel in y-down logical coordinates. */
export function createSourcePixelContour(
  x: number,
  y: number,
  width: number,
  height: number,
  sourceBaseline: number,
  context: ProviderContext,
): Contour {
  if (width <= 0 || height <= 0) {
    throw new InvalidProviderError("Source pixel dimensions must be positive");
  }
  const xMin = toFontCoordinate(x, context, "pixel x");
  const xMax = toFontCoordinate(x + width, context, "pixel xMax");
  const yMin = minecraftRelativeYToOpenTypeY(
    y + height,
    sourceBaseline,
    context.scale,
  );
  const yMax = minecraftRelativeYToOpenTypeY(
    y,
    sourceBaseline,
    context.scale,
  );
  if (!Number.isSafeInteger(yMin) || !Number.isSafeInteger(yMax)) {
    throw new InvalidProviderError("Source pixel y coordinates are not on the OpenType grid");
  }

  return createLineContour([
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ], "counterclockwise");
}

export function createProviderGlyph(
  codepoint: number,
  contours: readonly Contour[],
  metrics: SourceGlyphMetrics,
  context: ProviderContext,
  providerType: string,
  metricRounding: "reject" | "round" = "reject",
): MinecraftGlyph {
  assertUnicodeScalar(codepoint);
  try {
    const normalizedMetrics = metricRounding === "reject"
      ? minecraftGlyphMetricsToFontUnits(metrics, context.scale)
      : {
        advance: Math.round(minecraftToFontUnits(metrics.advance, context.scale)),
        boldOffset: Math.round(minecraftToFontUnits(metrics.boldOffset, context.scale)),
        bearingLeft: Math.round(minecraftToFontUnits(metrics.bearingLeft, context.scale)),
        bearingTop: Math.round(minecraftToFontUnits(metrics.bearingTop, context.scale)),
      };
    return createMinecraftGlyph({
      codepoint,
      contours,
      metrics: normalizedMetrics,
    });
  } catch (error) {
    if (error instanceof InvalidProviderError) throw error;
    throw new InvalidProviderError(
      `Unable to normalize ${providerType} glyph U+${codepoint.toString(16).toUpperCase()}`,
      providerType,
      undefined,
      codepoint,
      error,
    );
  }
}

export function ensureIntegerCoordinate(
  value: number,
  name: string,
  rounding: "reject" | "round" = "reject",
): number {
  if (!Number.isFinite(value)) {
    throw new InvalidProviderError(`${name} must be finite`);
  }
  if (Number.isSafeInteger(value)) return value;
  if (rounding === "round") return Math.round(value);
  throw new InvalidProviderError(
    `${name}=${value} is not representable on the configured OpenType grid`,
  );
}

export function readSkipCodepoints(skip: readonly string[]): ReadonlySet<number> {
  const result = new Set<number>();
  for (const item of skip) {
    for (const character of Array.from(item)) {
      const codepoint = character.codePointAt(0);
      if (codepoint !== undefined) result.add(codepoint);
    }
  }
  return result;
}
