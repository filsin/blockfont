declare const minecraftUnitBrand: unique symbol;
declare const fontUnitBrand: unique symbol;
declare const integerFontUnitBrand: unique symbol;

/** A coordinate expressed in Minecraft's logical pixel space. */
export type MinecraftUnit = number & {
  readonly [minecraftUnitBrand]: "MinecraftUnit";
};

/** A finite coordinate in the OpenType coordinate space. */
export type FontUnit = number & {
  readonly [fontUnitBrand]: "FontUnit";
};

/** A FontUnit that has passed the integer-grid boundary validation. */
export type IntegerFontUnit = FontUnit & {
  readonly [integerFontUnitBrand]: "IntegerFontUnit";
};

/** Input forms accepted at JSON/provider boundaries. */
export type MinecraftUnitInput = number | MinecraftUnit;
export type FontUnitInput = number | FontUnit;

/** The OpenType units-per-em value for a generated font. */
export type UnitsPerEm = number;

/**
 * Scale used when translating Minecraft coordinates to OpenType coordinates.
 *
 * `fontUnitsPerMinecraftPixel` must be even so that half-pixels are exactly
 * representable. `unitsPerEm` is kept separate because a future generator may
 * choose an em size independently of the Minecraft pixel scale.
 */
export interface CoordinateScale {
  readonly fontUnitsPerMinecraftPixel: number;
  readonly unitsPerEm: UnitsPerEm;
}

/** Coordinate convention of normalized glyph geometry and metrics. */
export interface FontCoordinateSystem {
  readonly xAxis: "right";
  readonly yAxis: "up";
  readonly origin: "baseline";
  readonly unit: "fontUnit";
}

/**
 * Every normalized glyph uses OpenType's coordinate convention: the origin is
 * the baseline, x grows to the right and y grows upward.
 */
export const NORMALIZED_FONT_COORDINATE_SYSTEM: Readonly<FontCoordinateSystem> =
  Object.freeze({
    xAxis: "right",
    yAxis: "up",
    origin: "baseline",
    unit: "fontUnit",
  });

/** One Minecraft pixel in the stable default OpenType grid. */
export const FONT_UNITS_PER_MINECRAFT_PIXEL = 128;

/** One half Minecraft pixel in the stable default OpenType grid. */
export const FONT_UNITS_PER_MINECRAFT_HALF_PIXEL =
  FONT_UNITS_PER_MINECRAFT_PIXEL / 2;

/** Convenient aliases for callers that use the shorter terminology. */
export const FONT_UNITS_PER_PIXEL = FONT_UNITS_PER_MINECRAFT_PIXEL;
export const FONT_UNITS_PER_HALF_PIXEL = FONT_UNITS_PER_MINECRAFT_HALF_PIXEL;

/**
 * Default em size: 16 Minecraft pixels at 128 units per pixel.
 *
 * The scale remains configurable for providers or future font families whose
 * em size is not 16 logical Minecraft pixels.
 */
export const DEFAULT_UNITS_PER_EM = 2048;

export const DEFAULT_COORDINATE_SCALE: Readonly<CoordinateScale> =
  Object.freeze({
    fontUnitsPerMinecraftPixel: FONT_UNITS_PER_MINECRAFT_PIXEL,
    unitsPerEm: DEFAULT_UNITS_PER_EM,
  });

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

/**
 * Validates a scale at every public conversion boundary. Callers may pass an
 * object literal, so relying only on createCoordinateScale would leave the
 * invariant bypassable at runtime.
 */
export function validateCoordinateScale(
  scale: CoordinateScale,
): Readonly<CoordinateScale> {
  if (scale === null || typeof scale !== "object") {
    throw new RangeError("Coordinate scale must be an object");
  }

  assertPositiveInteger(
    scale.fontUnitsPerMinecraftPixel,
    "fontUnitsPerMinecraftPixel",
  );
  assertPositiveInteger(scale.unitsPerEm, "unitsPerEm");

  if (scale.fontUnitsPerMinecraftPixel % 2 !== 0) {
    throw new RangeError(
      "fontUnitsPerMinecraftPixel must be even to represent half-pixels",
    );
  }

  if (scale.unitsPerEm % scale.fontUnitsPerMinecraftPixel !== 0) {
    throw new RangeError(
      "unitsPerEm must be a multiple of fontUnitsPerMinecraftPixel",
    );
  }

  return scale;
}

/**
 * Creates and validates a coordinate scale.
 *
 * An even number of font units per pixel is required by the core contract so
 * that a half-pixel never needs destructive rounding.
 */
export function createCoordinateScale(
  fontUnitsPerMinecraftPixel = FONT_UNITS_PER_MINECRAFT_PIXEL,
  unitsPerEm = DEFAULT_UNITS_PER_EM,
): Readonly<CoordinateScale> {
  return Object.freeze(validateCoordinateScale({
    fontUnitsPerMinecraftPixel,
    unitsPerEm,
  }));
}

/** Converts a Minecraft coordinate to the configured OpenType grid. */
export function minecraftToFontUnits(
  value: MinecraftUnitInput,
  scale: CoordinateScale = DEFAULT_COORDINATE_SCALE,
): FontUnit {
  validateCoordinateScale(scale);
  assertFinite(value, "Minecraft coordinate");
  return asFontUnit(value * scale.fontUnitsPerMinecraftPixel);
}

/** Converts an OpenType coordinate back to Minecraft logical pixels. */
export function fontUnitsToMinecraft(
  value: FontUnitInput,
  scale: CoordinateScale = DEFAULT_COORDINATE_SCALE,
): MinecraftUnit {
  validateCoordinateScale(scale);
  assertFinite(value, "Font coordinate");
  return asMinecraftUnit(value / scale.fontUnitsPerMinecraftPixel);
}

/** More explicit aliases for code that handles pixel coordinates. */
export const minecraftPixelsToFontUnits = minecraftToFontUnits;
export const fontUnitsToMinecraftPixels = fontUnitsToMinecraft;

/** Returns whether a value is representable as an integer OpenType unit. */
export function isIntegerFontUnit(
  value: FontUnitInput,
): value is IntegerFontUnit {
  return Number.isSafeInteger(value) && Number.isFinite(value);
}

/** Brands a finite Minecraft coordinate at an input boundary. */
export function asMinecraftUnit(value: number): MinecraftUnit {
  assertFinite(value, "Minecraft coordinate");
  return value as MinecraftUnit;
}

/** Brands a finite OpenType coordinate before integer-grid validation. */
export function asFontUnit(value: number): FontUnit {
  assertFinite(value, "Font coordinate");
  return value as FontUnit;
}

/**
 * Asserts that a converted coordinate is valid for an OpenType contour or
 * metric. Conversion itself never rounds; callers must choose an explicit
 * policy if their source contains a value outside the selected grid.
 */
export function asIntegerFontUnit(
  value: FontUnitInput,
  name = "Font coordinate",
): IntegerFontUnit {
  if (!isIntegerFontUnit(value)) {
    throw new RangeError(`${name} must be a finite safe integer`);
  }
  return value as IntegerFontUnit;
}

/**
 * Converts a Minecraft y coordinate (positive down) into an OpenType y
 * coordinate (positive up), relative to a source Minecraft baseline.
 *
 * This helper is intentionally separate from font-wide vertical metrics:
 * normalized glyph coordinates use the baseline as their origin, so this
 * function must be used to place geometry without applying a second baseline
 * translation later.
 */
export function minecraftRelativeYToOpenTypeY(
  y: MinecraftUnitInput,
  sourceBaseline: MinecraftUnitInput = 0,
  scale: CoordinateScale = DEFAULT_COORDINATE_SCALE,
): FontUnit {
  validateCoordinateScale(scale);
  assertFinite(sourceBaseline, "Minecraft source baseline");
  return minecraftToFontUnits(sourceBaseline - y, scale);
}

/** Backwards-compatible descriptive alias for baseline-relative conversion. */
export const minecraftYToOpenTypeY = minecraftRelativeYToOpenTypeY;

/** Inverse of {@link minecraftRelativeYToOpenTypeY}. */
export function openTypeRelativeYToMinecraftY(
  y: FontUnitInput,
  sourceBaseline: MinecraftUnitInput = 0,
  scale: CoordinateScale = DEFAULT_COORDINATE_SCALE,
): MinecraftUnit {
  validateCoordinateScale(scale);
  assertFinite(sourceBaseline, "Minecraft source baseline");
  return asMinecraftUnit(
    sourceBaseline - fontUnitsToMinecraft(y, scale),
  );
}

/** Backwards-compatible descriptive alias for baseline-relative conversion. */
export const openTypeYToMinecraftY = openTypeRelativeYToMinecraftY;
