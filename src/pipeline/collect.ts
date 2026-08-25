import { inflateRawSync } from "node:zlib";

import {
  parseResourceLocation,
  normalizeFontId,
  type AssetStore,
} from "../assets";
import type { MinecraftFontDefinition } from "../providers";
import type { MinecraftGlyph } from "../core";
import {
  BlockFontCoverageError,
  InvalidBlockFontOptionsError,
} from "./errors";
import type {
  BlockFontGlyphResolver,
  GlyphCollectionResult,
  MissingGlyphPolicy,
} from "./types";

const MAX_UNICODE = 0x10ffff;

function isUnicodeScalar(value: number): boolean {
  return Number.isInteger(value)
    && value >= 0
    && value <= MAX_UNICODE
    && !(value >= 0xd800 && value <= 0xdfff);
}

function assertUnicodeScalar(value: number): void {
  if (!isUnicodeScalar(value)) {
    throw new InvalidBlockFontOptionsError(
      `codepoints contains a value that is not a Unicode scalar: ${value}`,
    );
  }
}

function addCharacters(target: Set<number>, value: string): void {
  for (const character of Array.from(value)) {
    const codepoint = character.codePointAt(0);
    if (codepoint !== undefined) target.add(codepoint);
  }
}

function parseCodepointKey(value: string): number | undefined {
  if (Array.from(value).length === 1) return value.codePointAt(0);
  const trimmed = value.trim();
  if (/^U\+[0-9a-f]+$/i.test(trimmed)) {
    const codepoint = Number.parseInt(trimmed.slice(2), 16);
    return isUnicodeScalar(codepoint) ? codepoint : undefined;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    const codepoint = Number.parseInt(trimmed, 10);
    return isUnicodeScalar(codepoint) ? codepoint : undefined;
  }
  if (/^[0-9a-f]+$/i.test(trimmed)) {
    const codepoint = Number.parseInt(trimmed, 16);
    return isUnicodeScalar(codepoint) ? codepoint : undefined;
  }
  return undefined;
}

function addMapKeys(target: Set<number>, values: Readonly<Record<string, number>>): void {
  for (const key of Object.keys(values)) {
    const codepoint = parseCodepointKey(key);
    if (codepoint !== undefined) target.add(codepoint);
  }
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
    | ((bytes[offset + 3] ?? 0) << 24);
}

function extractZipTextEntries(bytes: Uint8Array): string[] {
  const result: string[] = [];
  const view = Buffer.from(bytes);
  for (let offset = 0; offset + 46 <= view.length; offset += 1) {
    if (readU32(bytes, offset) !== 0x02014b50) continue;
    const method = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20) >>> 0;
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const localOffset = readU32(bytes, offset + 42) >>> 0;
    if (localOffset + 30 > view.length || localOffset + 30 > bytes.length) continue;
    if (readU32(bytes, localOffset) !== 0x04034b50) continue;
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > view.length) continue;
    const compressed = view.subarray(dataOffset, dataOffset + compressedSize);
    try {
      const decoded = method === 0
        ? compressed
        : method === 8
          ? inflateRawSync(compressed)
          : undefined;
      if (decoded !== undefined) result.push(decoded.toString("utf8"));
    } catch {
      // A malformed entry is reported later if no valid Unihex record exists.
    }
    offset += nameLength + extraLength + commentLength;
  }
  return result;
}

function extractUnihexCodepoints(bytes: Uint8Array): readonly number[] {
  const isZip = bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  const texts = isZip
    ? extractZipTextEntries(bytes)
    : [new TextDecoder("utf-8", { fatal: true }).decode(bytes)];
  const result = new Set<number>();
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([0-9a-f]{1,6}):/i.exec(line);
      if (match === null) continue;
      const codepoint = Number.parseInt(match[1]!, 16);
      if (isUnicodeScalar(codepoint)) result.add(codepoint);
    }
  }
  if (result.size === 0) {
    throw new BlockFontCoverageError("Unihex asset contains no discoverable codepoints");
  }
  return [...result];
}

async function readProviderAsset(
  store: AssetStore,
  version: string,
  resource: string,
): Promise<Uint8Array> {
  return store.read(version, parseResourceLocation(resource));
}

async function addTtfCodepoints(
  target: Set<number>,
  store: AssetStore,
  version: string,
  resource: string,
): Promise<void> {
  const { parse } = await import("opentype.js");
  const bytes = await readProviderAsset(store, version, resource);
  let font;
  try {
    font = parse(new Uint8Array(bytes).buffer);
  } catch (error) {
    throw new BlockFontCoverageError(
      `Unable to inspect TTF provider asset: ${resource}`,
      error,
    );
  }
  for (let index = 0; index < font.glyphs.length; index += 1) {
    const glyph = font.glyphs.get(index);
    for (const codepoint of glyph.unicodes) {
      if (isUnicodeScalar(codepoint)) target.add(codepoint);
    }
  }
}

async function addDefinitionCodepoints(
  target: Set<number>,
  resolver: BlockFontGlyphResolver,
  store: AssetStore | undefined,
  version: string,
  fontId: string,
  visited: Set<string>,
): Promise<void> {
  if (resolver.loadFont === undefined) {
    throw new BlockFontCoverageError(
      "Automatic coverage discovery requires a resolver with loadFont; provide codepoints or characters instead",
    );
  }
  const normalized = normalizeFontId(fontId);
  if (visited.has(normalized)) return;
  visited.add(normalized);
  const definition = await resolver.loadFont(normalized, version);
  await addProviderDefinitionCodepoints(
    target,
    resolver,
    store,
    version,
    definition,
    visited,
  );
}

async function addProviderDefinitionCodepoints(
  target: Set<number>,
  resolver: BlockFontGlyphResolver,
  store: AssetStore | undefined,
  version: string,
  definition: MinecraftFontDefinition,
  visited: Set<string>,
): Promise<void> {
  for (const provider of definition.providers) {
    switch (provider.type) {
      case "bitmap":
        for (const row of provider.chars) addCharacters(target, row);
        break;
      case "space":
        addMapKeys(target, provider.advances);
        break;
      case "reference":
        await addDefinitionCodepoints(target, resolver, store, version, provider.id, visited);
        break;
      case "unihex": {
        if (store === undefined) {
          throw new BlockFontCoverageError(
            "Automatic Unihex coverage discovery requires an asset store; provide codepoints or characters instead",
          );
        }
        const bytes = await readProviderAsset(store, version, provider.hexFile);
        for (const codepoint of await extractUnihexCodepoints(bytes)) target.add(codepoint);
        break;
      }
      case "ttf":
        if (store === undefined) {
          throw new BlockFontCoverageError(
            "Automatic TTF coverage discovery requires an asset store; provide codepoints or characters instead",
          );
        }
        await addTtfCodepoints(target, store, version, provider.file);
        break;
    }
  }
}

/** Discovers coverage from the declared providers without downloading assets. */
export async function discoverMinecraftCodepoints(
  resolver: BlockFontGlyphResolver,
  version: string,
  fontId: string,
): Promise<readonly number[]> {
  const target = new Set<number>();
  await addDefinitionCodepoints(
    target,
    resolver,
    resolver.store,
    version,
    fontId,
    new Set<string>(),
  );
  return Object.freeze([...target].sort((left, right) => left - right));
}

function normalizeExplicitCodepoints(
  value: Iterable<number> | string,
): readonly number[] {
  const result = new Set<number>();
  if (typeof value === "string") {
    addCharacters(result, value);
  } else {
    for (const codepoint of value) {
      assertUnicodeScalar(codepoint);
      if (result.has(codepoint)) {
        throw new InvalidBlockFontOptionsError(
          `codepoints contains a duplicate value: ${codepoint}`,
        );
      }
      result.add(codepoint);
    }
  }
  if (result.size === 0) {
    throw new InvalidBlockFontOptionsError("codepoints/characters must not be empty");
  }
  return Object.freeze([...result].sort((left, right) => left - right));
}

import type { CharacterPreset } from "../core/generation";
import { filterCodepointsByPresets } from "./presets";

export interface CollectMinecraftGlyphsOptions {
  readonly resolver: BlockFontGlyphResolver;
  readonly version: string;
  readonly fontId: string;
  readonly codepoints?: Iterable<number> | string;
  readonly characters?: string;
  readonly preset?: CharacterPreset | readonly CharacterPreset[];
  readonly presets?: readonly CharacterPreset[];
  readonly missingGlyphPolicy?: MissingGlyphPolicy;
  readonly onProgress?: (processed: number, total: number) => void;
}

/** Resolves the requested/discovered coverage into provider-independent glyphs. */
export async function collectMinecraftGlyphs(
  options: CollectMinecraftGlyphsOptions,
): Promise<GlyphCollectionResult> {
  if (options.codepoints !== undefined && options.characters !== undefined) {
    throw new InvalidBlockFontOptionsError(
      "Use either codepoints or characters, not both",
    );
  }
  const activePresets = options.presets ?? (options.preset !== undefined ? (Array.isArray(options.preset) ? options.preset : [options.preset]) : undefined);

  let requested: readonly number[];
  const explicitCodepoints = options.codepoints !== undefined
    ? normalizeExplicitCodepoints(options.codepoints)
    : options.characters !== undefined
      ? normalizeExplicitCodepoints(options.characters)
      : undefined;

  if (explicitCodepoints !== undefined && activePresets === undefined) {
    requested = explicitCodepoints;
  } else {
    const discovered = await discoverMinecraftCodepoints(
      options.resolver,
      options.version,
      options.fontId,
    );
    const filteredDiscovered = activePresets !== undefined
      ? filterCodepointsByPresets(discovered, activePresets)
      : discovered;

    if (explicitCodepoints !== undefined) {
      const combined = new Set([...filteredDiscovered, ...explicitCodepoints]);
      requested = Object.freeze([...combined].sort((a, b) => a - b));
    } else {
      requested = filteredDiscovered;
    }
  }



  if (requested.length === 0) {
    throw new BlockFontCoverageError("Font definition contains no discoverable glyphs");
  }


  const glyphs: MinecraftGlyph[] = [];
  const missing: number[] = [];
  const BATCH_SIZE = 500;
  options.onProgress?.(0, requested.length);
  for (let i = 0; i < requested.length; i += BATCH_SIZE) {
    const batch = requested.slice(i, i + BATCH_SIZE);
    const resolvedBatch = await Promise.all(
      batch.map((codepoint) =>
        options.resolver.resolveGlyph(codepoint, options.fontId, options.version),
      ),
    );
    for (let j = 0; j < batch.length; j += 1) {
      const glyph = resolvedBatch[j];
      const codepoint = batch[j]!;
      if (glyph === undefined) {
        missing.push(codepoint);
      } else {
        glyphs.push(glyph);
      }
    }
    options.onProgress?.(i + batch.length, requested.length);
  }


  if (glyphs.length === 0) {
    throw new BlockFontCoverageError(
      `No glyph could be resolved from ${requested.length} requested codepoint(s)`,
    );
  }
  const missingGlyphPolicy = options.missingGlyphPolicy ?? "error";
  if (missingGlyphPolicy === "error" && missing.length > 0) {
    const labels = missing
      .map((codepoint) => `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`)
      .join(", ");
    throw new BlockFontCoverageError(
      `Unable to resolve ${missing.length} requested codepoint(s): ${labels}`,
    );
  }
  return Object.freeze({
    codepoints: Object.freeze(glyphs.map((glyph) => glyph.codepoint)),
    glyphs: Object.freeze(glyphs),
    missingCodepoints: Object.freeze(missing),
  });
}
