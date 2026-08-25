import { describe, expect, it } from "vitest";

import {
  DEFAULT_COORDINATE_SCALE,
  FONT_UNITS_PER_MINECRAFT_HALF_PIXEL,
  FONT_UNITS_PER_MINECRAFT_PIXEL,
  asFontUnit,
  asIntegerFontUnit,
  asMinecraftUnit,
  createCoordinateScale,
  fontUnitsToMinecraft,
  minecraftToFontUnits,
  minecraftRelativeYToOpenTypeY,
  openTypeRelativeYToMinecraftY,
  validateCoordinateScale,
} from "../../src/core/units";

describe("coordinate units", () => {
  it("uses the documented integer scale for pixels and half-pixels", () => {
    expect(FONT_UNITS_PER_MINECRAFT_PIXEL).toBe(128);
    expect(FONT_UNITS_PER_MINECRAFT_HALF_PIXEL).toBe(64);
    expect(minecraftToFontUnits(1)).toBe(128);
    expect(minecraftToFontUnits(0.5)).toBe(64);
    expect(fontUnitsToMinecraft(64)).toBe(0.5);
  });

  it("round-trips coordinates without applying hidden rounding", () => {
    const coordinate = 2.25;
    expect(
      fontUnitsToMinecraft(minecraftToFontUnits(coordinate)),
    ).toBe(coordinate);
  });

  it("converts the downward Minecraft y-axis to OpenType's upward axis", () => {
    expect(minecraftRelativeYToOpenTypeY(8, 8)).toBe(0);
    expect(minecraftRelativeYToOpenTypeY(7, 8)).toBe(128);
    expect(minecraftRelativeYToOpenTypeY(9, 8)).toBe(-128);
    expect(openTypeRelativeYToMinecraftY(-128, 8)).toBe(9);
  });

  it("requires an even number of units per Minecraft pixel", () => {
    expect(() => createCoordinateScale(127)).toThrow(RangeError);
    expect(createCoordinateScale(256, 4096).fontUnitsPerMinecraftPixel).toBe(
      256,
    );
    expect(() => createCoordinateScale(128, 2000)).toThrow(RangeError);
    expect(() =>
      validateCoordinateScale({ fontUnitsPerMinecraftPixel: 127, unitsPerEm: 2048 }),
    ).toThrow(RangeError);
    expect(() =>
      validateCoordinateScale({ fontUnitsPerMinecraftPixel: 128, unitsPerEm: 2000 }),
    ).toThrow(RangeError);
    expect(() => minecraftToFontUnits(1, {
      fontUnitsPerMinecraftPixel: 127,
      unitsPerEm: 2048,
    })).toThrow(RangeError);
  });

  it("rejects non-integer coordinates only at the explicit OpenType boundary", () => {
    expect(minecraftToFontUnits(0.1)).toBe(12.8);
    expect(() => asIntegerFontUnit(12.8)).toThrow(RangeError);
    expect(asIntegerFontUnit(64)).toBe(64);
    expect(asMinecraftUnit(0.1)).toBe(0.1);
    expect(asFontUnit(12.8)).toBe(12.8);
    expect(DEFAULT_COORDINATE_SCALE.unitsPerEm).toBe(2048);
  });
});
