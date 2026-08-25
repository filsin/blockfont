import {
  readAssetJson,
  type AssetStore,
} from "../assets";
import {
  fontIdToResourceLocation,
  normalizeFontId,
  parseResourceLocation,
  type ResourceLocationInput,
} from "../assets/resource-location";
import {
  InvalidProviderError,
  UnsupportedProviderError,
} from "./errors";

export interface CommonProviderDefinition {
  readonly boldOffset?: number;
  readonly advance?: number;
  readonly advances?: Readonly<Record<string, number>>;
  readonly bearingLeft?: number;
  readonly bearingTop?: number;
}

export interface BitmapProviderDefinition extends CommonProviderDefinition {
  readonly type: "bitmap";
  readonly file: string;
  readonly ascent: number;
  readonly height?: number;
  readonly chars: readonly string[];
}

export interface UnihexSizeOverride {
  readonly from: number;
  readonly to: number;
  readonly left: number;
  readonly right: number;
}

export interface UnihexProviderDefinition extends CommonProviderDefinition {
  readonly type: "unihex";
  readonly hexFile: string;
  readonly sizeOverrides: readonly UnihexSizeOverride[];
  /** Logical pixel scale of a source Unihex cell. Defaults to 1. */
  readonly resolution?: number;
  readonly height?: number;
  readonly ascent?: number;
}

export interface SpaceProviderDefinition extends CommonProviderDefinition {
  readonly type: "space";
  readonly advances: Readonly<Record<string, number>>;
}

export interface ReferenceProviderDefinition extends CommonProviderDefinition {
  readonly type: "reference";
  readonly id: string;
}

export interface TtfProviderDefinition extends CommonProviderDefinition {
  readonly type: "ttf";
  readonly file: string;
  readonly size?: number;
  /** Only `1` is supported; larger vanilla oversampling is rejected explicitly. */
  readonly oversample?: number;
  readonly shift?: readonly [number, number];
  readonly skip: readonly string[];
  /** Explicit policy for non-integral target font coordinates. */
  readonly coordinateRounding?: "reject" | "round";
}

export type MinecraftProviderDefinition =
  | BitmapProviderDefinition
  | UnihexProviderDefinition
  | SpaceProviderDefinition
  | ReferenceProviderDefinition
  | TtfProviderDefinition;

export interface MinecraftFontDefinition {
  readonly providers: readonly MinecraftProviderDefinition[];
  readonly sourceResource?: string;
}

type RecordValue = Record<string, unknown>;

function isUnicodeScalar(value: number): boolean {
  return Number.isInteger(value)
    && value >= 0
    && value <= 0x10ffff
    && !(value >= 0xd800 && value <= 0xdfff);
}

function assertUnicodeScalarValue(value: number, name: string, type: string): number {
  if (!isUnicodeScalar(value)) {
    providerError(`${name} is not a Unicode scalar value`, type);
  }
  return value;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerError(message: string, type?: string, cause?: unknown): never {
  throw new InvalidProviderError(message, type, undefined, undefined, cause);
}

function requiredString(value: unknown, name: string, type?: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    providerError(`${name} must be a non-empty string`, type);
  }
  return value.trim();
}

function requiredResource(value: unknown, name: string, type: string): string {
  const resource = requiredString(value, name, type);
  try {
    parseResourceLocation(resource);
  } catch (error) {
    providerError(`${name} must be a safe resource location`, type, error);
  }
  return resource;
}

function requiredFontId(value: unknown, name: string, type: string): string {
  const fontId = requiredString(value, name, type);
  try {
    normalizeFontId(fontId);
  } catch (error) {
    providerError(`${name} must be a safe font id`, type, error);
  }
  return fontId;
}

function optionalString(
  record: RecordValue,
  key: string,
  type?: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return requiredString(value, key, type);
}

function requiredNumber(value: unknown, name: string, type?: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    providerError(`${name} must be a finite number`, type);
  }
  return value;
}

function optionalNumber(
  record: RecordValue,
  key: string,
  type?: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return requiredNumber(value, key, type);
}

function positiveNumber(value: number, name: string, type: string): number {
  if (value <= 0) {
    providerError(`${name} must be greater than zero`, type);
  }
  return value;
}

function nonNegativeNumber(value: number, name: string, type: string): number {
  if (value < 0) {
    providerError(`${name} must be non-negative`, type);
  }
  return value;
}

function parseNumericMap(
  value: unknown,
  name: string,
  type: string,
): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    providerError(`${name} must be an object`, type);
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.length === 0) providerError(`${name} contains an empty key`, type);
    result[key] = nonNegativeNumber(
      requiredNumber(raw, `${name}.${key}`, type),
      `${name}.${key}`,
      type,
    );
  }
  return Object.freeze(result);
}

function parseCommon(record: RecordValue, type: string): CommonProviderDefinition {
  const result: {
    boldOffset?: number;
    advance?: number;
    advances?: Readonly<Record<string, number>>;
    bearingLeft?: number;
    bearingTop?: number;
  } = {};

  const boldOffset = optionalNumber(record, "boldOffset", type);
  if (boldOffset !== undefined) result.boldOffset = nonNegativeNumber(boldOffset, "boldOffset", type);
  const advance = optionalNumber(record, "advance", type);
  if (advance !== undefined) result.advance = nonNegativeNumber(advance, "advance", type);
  const advances = parseNumericMap(record.advances, "advances", type);
  if (advances !== undefined) result.advances = advances;
  const bearingLeft = optionalNumber(record, "bearingLeft", type);
  if (bearingLeft !== undefined) result.bearingLeft = bearingLeft;
  const bearingTop = optionalNumber(record, "bearingTop", type);
  if (bearingTop !== undefined) result.bearingTop = bearingTop;
  return result;
}

function parseChars(value: unknown, type: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    providerError("chars must be a non-empty array", type);
  }
  const chars: string[] = [];
  const seen = new Set<number>();
  for (const row of value) {
    if (typeof row !== "string" || row.length === 0) {
      providerError("every chars entry must be a non-empty string", type);
    }
    for (const character of Array.from(row)) {
      const codepoint = character.codePointAt(0);
      if (codepoint === undefined || codepoint === 0) continue;
      assertUnicodeScalarValue(codepoint, "chars entry", type);
      if (seen.has(codepoint)) {
        providerError(`character U+${codepoint.toString(16)} appears more than once`, type);
      }
      seen.add(codepoint);
    }
    chars.push(row);
  }
  return Object.freeze(chars);
}

function parseCodepointToken(value: unknown, name: string, type: string): number {
  if (typeof value === "number") {
    return assertUnicodeScalarValue(value, name, type);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    providerError(`${name} must be a codepoint string or number`, type);
  }
  const token = value.trim();
  if (Array.from(token).length === 1) {
    return assertUnicodeScalarValue(token.codePointAt(0) as number, name, type);
  }
  const hex = token.replace(/^U\+/i, "");
  if (!/^[0-9a-f]+$/i.test(hex)) {
    providerError(`${name} is not a hexadecimal codepoint`, type);
  }
  const codepoint = Number.parseInt(hex, 16);
  return assertUnicodeScalarValue(codepoint, name, type);
}

function parseSizeOverrides(value: unknown, type: string): readonly UnihexSizeOverride[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) providerError("size_overrides must be an array", type);
  const result: UnihexSizeOverride[] = [];
  for (const item of value) {
    if (!isRecord(item)) providerError("size_overrides entries must be objects", type);
    const from = parseCodepointToken(item.from, "size_overrides.from", type);
    const to = parseCodepointToken(item.to, "size_overrides.to", type);
    const left = nonNegativeNumber(requiredNumber(item.left, "size_overrides.left", type), "left", type);
    const right = nonNegativeNumber(requiredNumber(item.right, "size_overrides.right", type), "right", type);
    if (to < from) providerError("size_overrides.to must be >= from", type);
    result.push({ from, to, left, right });
  }
  return Object.freeze(result);
}

function parseSkip(value: unknown, type: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  const items = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || item.length === 0) {
      providerError("ttf.skip entries must be non-empty strings", type);
    }
    for (const character of Array.from(item)) {
      assertUnicodeScalarValue(character.codePointAt(0) as number, "ttf.skip entry", type);
    }
    result.push(item);
  }
  return Object.freeze(result);
}

function parseShift(value: unknown, type: string): readonly [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) {
    providerError("ttf.shift must contain two numbers", type);
  }
  return Object.freeze([
    requiredNumber(value[0], "shift[0]", type),
    requiredNumber(value[1], "shift[1]", type),
  ]) as readonly [number, number];
}

function parseProvider(value: unknown, index: number): MinecraftProviderDefinition {
  if (!isRecord(value)) providerError(`providers[${index}] must be an object`);
  const typeValue = value.type;
  const type = requiredString(typeValue, `providers[${index}].type`);
  const common = parseCommon(value, type);

  switch (type) {
    case "bitmap": {
      const ascent = requiredNumber(value.ascent, "bitmap.ascent", type);
      const heightRaw = optionalNumber(value, "height", type);
      const height = heightRaw === undefined ? undefined : positiveNumber(heightRaw, "height", type);
      if (ascent < 0 || (height !== undefined && ascent > height)) {
        providerError("bitmap.ascent must be between zero and height", type);
      }
      return Object.freeze({
        ...common,
        type,
        file: requiredResource(value.file, "bitmap.file", type),
        ascent,
        ...(height === undefined ? {} : { height }),
        chars: parseChars(value.chars, type),
      });
    }
    case "unihex": {
      const resolutionRaw = value.resolution ?? value.scale ?? value.hex_size;
      let resolution: number | undefined;
      if (resolutionRaw !== undefined) {
        const parsed = typeof resolutionRaw === "string"
          ? Number.parseFloat(resolutionRaw.replace(/[^0-9.]/g, ""))
          : requiredNumber(resolutionRaw, "unihex.resolution", type);
        if (!Number.isFinite(parsed)) providerError("unihex.resolution must be numeric", type);
        resolution = positiveNumber(parsed, "resolution", type);
      }
      const heightRaw = optionalNumber(value, "height", type);
      const ascentRaw = optionalNumber(value, "ascent", type);
      return Object.freeze({
        ...common,
        type,
        hexFile: requiredResource(
          value.hex_file ?? value.file ?? value.template,
          "unihex.hex_file",
          type,
        ),
        sizeOverrides: parseSizeOverrides(value.size_overrides, type),
        ...(resolution === undefined ? {} : { resolution }),
        ...(heightRaw === undefined ? {} : { height: positiveNumber(heightRaw, "height", type) }),
        ...(ascentRaw === undefined ? {} : { ascent: ascentRaw }),
      });
    }
    case "space": {
      const advances = parseNumericMap(value.advances, "space.advances", type);
      if (advances === undefined || Object.keys(advances).length === 0) {
        providerError("space.advances must contain at least one character", type);
      }
      return Object.freeze({ ...common, type, advances });
    }
    case "reference":
      return Object.freeze({
        ...common,
        type,
        id: requiredFontId(value.id, "reference.id", type),
      });
    case "ttf": {
      const sizeRaw = optionalNumber(value, "size", type);
      const oversampleRaw = optionalNumber(value, "oversample", type);
      const oversample = oversampleRaw === undefined
        ? undefined
        : positiveNumber(oversampleRaw, "oversample", type);
      if (oversample !== undefined && oversample !== 1) {
        throw new UnsupportedProviderError(
          "TTF provider oversample is not implemented; use oversample 1 or omit the field",
          type,
        );
      }
      const coordinateRounding = value.coordinateRounding;
      if (
        coordinateRounding !== undefined &&
        coordinateRounding !== "reject" &&
        coordinateRounding !== "round"
      ) {
        providerError("ttf.coordinateRounding must be reject or round", type);
      }
      const shift = parseShift(value.shift, type);
      return Object.freeze({
        ...common,
        type,
        file: requiredResource(value.file, "ttf.file", type),
        skip: parseSkip(value.skip, type),
        ...(shift === undefined ? {} : { shift }),
        ...(sizeRaw === undefined ? {} : { size: positiveNumber(sizeRaw, "size", type) }),
        ...(oversample === undefined
          ? {}
          : { oversample }),
        ...(coordinateRounding === undefined ? {} : { coordinateRounding }),
      });
    }
    default:
      throw new UnsupportedProviderError(
        `Unsupported Minecraft font provider type: ${type}`,
        type,
      );
  }
}

/** Validates and normalizes a parsed Minecraft font JSON object. */
export function parseFontDefinition(
  value: unknown,
  sourceResource?: string,
): MinecraftFontDefinition {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    throw new InvalidProviderError("Font definition must contain a providers array");
  }
  if (value.providers.length === 0) {
    throw new InvalidProviderError("Font definition providers must not be empty");
  }
  const providers = value.providers.map((provider, index) => parseProvider(provider, index));
  return Object.freeze({
    providers: Object.freeze(providers),
    ...(sourceResource === undefined ? {} : { sourceResource }),
  });
}

/** Loads minecraft:default or another font id from an AssetStore. */
export async function loadFontDefinition(
  store: AssetStore,
  version: string,
  fontId = "minecraft:default",
): Promise<MinecraftFontDefinition> {
  const resource = fontIdToResourceLocation(fontId);
  const raw = await readAssetJson<unknown>(store, version, resource);
  try {
    return parseFontDefinition(raw, `${resource.namespace}:${resource.path}`);
  } catch (error) {
    if (error instanceof InvalidProviderError || error instanceof UnsupportedProviderError) {
      throw error;
    }
    throw new InvalidProviderError(
      `Unable to parse font definition ${normalizeFontId(fontId)}`,
      undefined,
      `${resource.namespace}:${resource.path}`,
      undefined,
      error,
    );
  }
}

/** Alias used by callers that prefer the JSON-oriented name. */
export const loadFontJson = loadFontDefinition;

export type FontResourceId = ResourceLocationInput;
