import { mkdir as nodeMkdir, writeFile as nodeWriteFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CachingAssetStore,
  LocalAssetSource,
  ensureMinecraftAssets,
  normalizeFontId,
  validateAssetVersion,
  type AssetSource,
  type AssetStore,
} from "../assets";
import type { Font } from "opentype.js";

import {
  createCoordinateScale,
  DEFAULT_COORDINATE_SCALE,
  type CoordinateScale,
  type FontFormat,
  type FontMetrics,
  type FontStyle,
  type MinecraftGlyph,
} from "../core";
import {
  createOpenTypeFont,
} from "../export";
import { createMinecraftFontResolver } from "../providers";
import { collectMinecraftGlyphs } from "./collect";
import {
  BlockFontGenerationError,
  BlockFontOutputError,
  InvalidBlockFontOptionsError,
} from "./errors";
import type {
  BlockFontDependencies,
  BlockFontFileSystem,
  BlockFontGenerationOptions,
  BlockFontGenerationResult,
  BlockFontGlyphResolver,
  BlockFontOutputFile,
  BlockFontGenerator,
  GenerationProgress,
} from "./types";


const DEFAULT_STYLES: readonly FontStyle[] = Object.freeze([
  "regular",
  "bold",
  "italic",
  "boldItalic",
]);
const DEFAULT_FORMATS: readonly FontFormat[] = Object.freeze(["ttf"]);
const STYLES: ReadonlySet<FontStyle> = new Set([
  "regular",
  "bold",
  "italic",
  "boldItalic",
]);
const FORMATS: ReadonlySet<FontFormat> = new Set(["ttf", "otf", "woff", "ttc"]);

function normalizeExcludeStyles(
  rawExclude: FontStyle | readonly FontStyle[] | string | undefined,
): readonly FontStyle[] {
  if (rawExclude === undefined) return [];
  const items = Array.isArray(rawExclude)
    ? rawExclude
    : typeof rawExclude === "string"
      ? rawExclude.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : [rawExclude];

  const result: FontStyle[] = [];
  for (const item of items) {
    const key = item.replace(/-/g, "").toLowerCase();
    if (key === "regular") result.push("regular");
    else if (key === "bold") result.push("bold");
    else if (key === "italic") result.push("italic");
    else if (key === "bolditalic") result.push("boldItalic");
    else {
      throw new InvalidBlockFontOptionsError(`Unsupported exclude style: "${item}". Expected regular, bold, italic, or bold-italic`);
    }
  }
  return result;
}

function nonEmpty(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new InvalidBlockFontOptionsError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function selectAlias<T>(...values: readonly (T | undefined)[]): T | undefined {
  return values.find((value) => value !== undefined);
}

function selectStringAlias(
  name: string,
  ...values: readonly (string | undefined)[]
): string | undefined {
  const defined = values.filter((value): value is string => value !== undefined);
  if (defined.length > 1) {
    const normalized = defined.map((value) => value.trim());
    if (normalized.some((value) => value !== normalized[0])) {
      throw new InvalidBlockFontOptionsError(
        `Conflicting aliases supplied for ${name}`,
      );
    }
  }
  return defined[0];
}

function normalizeList<T extends string>(
  value: readonly T[] | undefined,
  defaults: readonly T[],
  valid: ReadonlySet<T>,
  name: string,
): readonly T[] {
  const values = value === undefined ? [...defaults] : [...value];
  if (values.length === 0) {
    throw new InvalidBlockFontOptionsError(`${name} must not be empty`);
  }
  const seen = new Set<T>();
  for (const item of values) {
    if (!valid.has(item)) {
      throw new InvalidBlockFontOptionsError(`${name} contains an unsupported value: ${item}`);
    }
    if (seen.has(item)) {
      throw new InvalidBlockFontOptionsError(`${name} must not contain duplicates`);
    }
    seen.add(item);
  }
  return Object.freeze(values);
}

function chooseSingle<T>(
  preferred: readonly T[] | T | undefined,
  fallback: readonly T[] | T | undefined,
  name: string,
): readonly T[] | undefined {
  if (preferred !== undefined && fallback !== undefined && preferred !== fallback) {
    throw new InvalidBlockFontOptionsError(
      `Conflicting aliases supplied for ${name}`,
    );
  }
  const chosen = preferred ?? fallback;
  if (chosen === undefined) return undefined;
  return Array.isArray(chosen) ? chosen : [chosen as T];
}

import { fastWriteFile } from "../utils/bun-compat";

function createDefaultFileSystem(): BlockFontFileSystem {
  return {
    mkdir: (path, options) => nodeMkdir(path, options).then(() => undefined),
    writeFile: (path, data) => fastWriteFile(path, data),
  };
}

function chooseDependencies(
  options: BlockFontGenerationOptions,
): BlockFontDependencies {
  return options.dependencies ?? {};
}

function sameScale(left: CoordinateScale, right: CoordinateScale): boolean {
  return left.fontUnitsPerMinecraftPixel === right.fontUnitsPerMinecraftPixel
    && left.unitsPerEm === right.unitsPerEm;
}

function configuredCoordinateScale(
  options: BlockFontGenerationOptions,
): Readonly<CoordinateScale> | undefined {
  const injectedScale = options.scale;
  const unitsPerEm = options.unitsPerEm ?? options.fontMetrics?.unitsPerEm;
  if (injectedScale !== undefined) return injectedScale;
  if (unitsPerEm === undefined) return undefined;
  return createCoordinateScale(unitsPerEm / 16, unitsPerEm);
}

async function createAssetStoreForOptions(
  options: BlockFontGenerationOptions,
  dependencies: BlockFontDependencies,
  version: string,
  allowMissing: boolean,
): Promise<AssetStore | undefined> {
  const store = selectAlias<AssetStore>(
    options.assetStore,
    options.store,
    dependencies.assetStore,
    dependencies.store,
  );
  if (store !== undefined) return store;

  const source = selectAlias<AssetSource>(
    options.assetSource,
    options.source,
    dependencies.assetSource,
    dependencies.source,
  );
  if (source !== undefined) {
    return new CachingAssetStore({
      source,
      ...(options.cacheDirectory === undefined
        ? {}
        : { cacheDirectory: options.cacheDirectory }),
    });
  }

  const assetsDirectory = selectAlias(
    selectStringAlias("assets", options.assets, options.assetsDirectory),
  ) ?? "./assets";

  try {
    await ensureMinecraftAssets({ version, rootDirectory: assetsDirectory });
  } catch (error) {
    if (!allowMissing) {
      throw new InvalidBlockFontOptionsError(
        `Unable to acquire official Minecraft assets for ${version}`,
        error,
      );
    }
  }

  return new CachingAssetStore({
    source: new LocalAssetSource(assetsDirectory),
    ...(options.cacheDirectory === undefined
      ? {}
      : { cacheDirectory: options.cacheDirectory }),
  });
}

function getResolver(
  options: BlockFontGenerationOptions,
  dependencies: BlockFontDependencies,
  store: AssetStore | undefined,
  version: string,
  fontId: string,
  configuredScale: Readonly<CoordinateScale> | undefined,
): BlockFontGlyphResolver {
  const injected = options.resolver ?? dependencies.resolver;
  if (injected !== undefined) return injected;
  if (store === undefined) {
    throw new InvalidBlockFontOptionsError(
      "Automatic official Minecraft asset acquisition is not configured; provide an assetStore, assetSource, or assets directory when no resolver is injected",
    );
  }
  const resolverOptions = {
    store,
    minecraftVersion: version,
    defaultFontId: fontId,
    ...(configuredScale === undefined
      ? {}
      : { scale: configuredScale }),
  };
  return createMinecraftFontResolver(resolverOptions);
}

function styleLabel(style: FontStyle): string {
  switch (style) {
    case "regular": return "Regular";
    case "bold": return "Bold";
    case "italic": return "Italic";
    case "boldItalic": return "BoldItalic";
  }
}

function asciiTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)) >>> 0;
}

function writeU32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function sfntChecksum(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let sum = 0;
  const paddedEnd = start + Math.ceil((end - start) / 4) * 4;
  for (let offset = start; offset < paddedEnd; offset += 4) {
    sum = (sum + (
      ((bytes[offset] ?? 0) << 24)
      + ((bytes[offset + 1] ?? 0) << 16)
      + ((bytes[offset + 2] ?? 0) << 8)
      + (bytes[offset + 3] ?? 0)
    )) >>> 0;
  }
  return sum >>> 0;
}

function normalizeSubfontTimestamps(bytes: Uint8Array, fontOffset: number): void {
  if (fontOffset + 12 > bytes.length) return;
  const tableCount = readU16BE(bytes, fontOffset + 4);
  let headOffset = -1;
  let headLength = 0;
  for (let index = 0; index < tableCount; index += 1) {
    const record = fontOffset + 12 + index * 16;
    if (record + 16 > bytes.length) return;
    if (asciiTag(bytes, record) !== "head") continue;
    headOffset = readU32BE(bytes, record + 8);
    headLength = readU32BE(bytes, record + 12);
    break;
  }
  if (headOffset < 0 || headOffset + headLength > bytes.length || headLength < 36) {
    return;
  }
  for (const offset of [headOffset + 20, headOffset + 24, headOffset + 28, headOffset + 32]) {
    writeU32BE(bytes, offset, 0);
  }
}

/** Makes generated SFNT bytes reproducible by canonicalizing head timestamps. */
function normalizeSfntTimestamps(buffer: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(buffer.slice(0));
  if (bytes.length < 12) return bytes;
  const tag = asciiTag(bytes, 0);
  if (tag === "ttcf") {
    const numFonts = readU32BE(bytes, 8);
    for (let i = 0; i < numFonts; i += 1) {
      const fontOffset = readU32BE(bytes, 12 + i * 4);
      normalizeSubfontTimestamps(bytes, fontOffset);
    }
    return bytes;
  }
  normalizeSubfontTimestamps(bytes, 0);
  return bytes;
}

import { parallelStyleGlyphs } from "./parallel";
import type { StyledGlyph } from "../styles/variants";
import { createOpenTypeFontFromStyled, fontToTrueTypeOptions, generateTtcFont, serializeFont, serializeWoffFont } from "../export/font";
import { serializeTrueTypeCollection } from "../export/ttf";


function serializeStyledFontDeterministically(
  styled: readonly StyledGlyph[],
  style: FontStyle,
  format: FontFormat,
  options: {
    readonly familyName: string;
    readonly unitsPerEm?: number;
    readonly fontMetrics?: FontMetrics;
    readonly version?: string;
    readonly copyright?: string;
  },
): Uint8Array {
  const font = createOpenTypeFontFromStyled(styled, style, options);
  font.createdTimestamp = -2082844800;
  if (format === "woff") {
    const ttfBytes = normalizeSfntTimestamps(serializeFont(font, "ttf"));
    return new Uint8Array(serializeWoffFont(ttfBytes.buffer as ArrayBuffer));
  }
  return normalizeSfntTimestamps(serializeFont(font, format));
}

async function serializeDeterministicallyAsync(
  glyphs: readonly MinecraftGlyph[],
  style: FontStyle,
  format: FontFormat,
  options: {
    readonly familyName: string;
    readonly unitsPerEm?: number;
    readonly fontMetrics?: FontMetrics;
    readonly version?: string;
    readonly copyright?: string;
  },
  onProgress?: (progress: GenerationProgress) => void,
): Promise<Uint8Array> {
  const maxAllowed = 65534;

  let targetGlyphs = glyphs;
  if (targetGlyphs.length > maxAllowed) {
    onProgress?.({
      stage: "font-building",
      message: `OpenType limit (65,535 numGlyphs max): Capping ${targetGlyphs.length} glyphs to ${maxAllowed} for ${style}...`,
    });
    targetGlyphs = targetGlyphs.slice(0, maxAllowed);
  }

  onProgress?.({
    stage: "font-building",
    message: `Vectorizing ${style} glyphs in parallel across worker threads...`,
    total: targetGlyphs.length,
  });
  const styled = await parallelStyleGlyphs(
    targetGlyphs,
    style,
    (cur, tot) => {
      onProgress?.({
        stage: "font-building",
        message: `Vectorizing ${style} glyphs (${cur}/${tot})`,
        current: cur,
        total: tot,
      });
    },
    options.unitsPerEm,
  );

  return serializeStyledFontDeterministically(styled, style, format, options);
}


/** Generates the requested BlockFont files and writes them to disk. */
export async function generateBlockFont(
  options: BlockFontGenerationOptions,
): Promise<BlockFontGenerationResult> {
  const version = nonEmpty(
    selectStringAlias("version", options.version, options.minecraftVersion),
    "version",
  );
  try {
    validateAssetVersion(version);
  } catch (error) {
    throw new InvalidBlockFontOptionsError(`Invalid Minecraft version: ${version}`, error);
  }
  const fontId = nonEmpty(options.fontId ?? "minecraft:default", "fontId");
  try {
    normalizeFontId(fontId);
  } catch (error) {
    throw new InvalidBlockFontOptionsError(`Invalid fontId: ${fontId}`, error);
  }
  const familyName = nonEmpty(options.familyName ?? "BlockFont", "familyName");
  const outputDirectory = resolve(nonEmpty(
    selectStringAlias("outputDirectory", options.outputDirectory, options.output),
    "outputDirectory",
  ));
  const styles = normalizeList(
    chooseSingle(options.styles, options.style, "style"),
    DEFAULT_STYLES,
    STYLES,
    "styles",
  );
  const formats = normalizeList(
    chooseSingle(options.formats, options.format, "format"),
    DEFAULT_FORMATS,
    FORMATS,
    "formats",
  );
  const rawExclude = options.exclude ?? options.excludes;
  const excludedStyles = normalizeExcludeStyles(rawExclude);
  if (excludedStyles.length > 0 && !formats.includes("ttc")) {
    throw new InvalidBlockFontOptionsError(
      `The "exclude" option is only supported when generating "ttc" format fonts.`,
    );
  }
  const dependencies = chooseDependencies(options);
  const configuredScale = configuredCoordinateScale(options);

  options.onProgress?.({
    stage: "assets-loading",
    message: `Loading Minecraft assets for version ${version}...`,
  });

  const store = await createAssetStoreForOptions(
    options,
    dependencies,
    version,
    options.resolver === undefined && dependencies.resolver === undefined ? false : true,
  );
  const resolver = getResolver(
    options,
    dependencies,
    store,
    version,
    fontId,
    configuredScale,
  );

  options.onProgress?.({
    stage: "glyph-collection",
    message: `Discovering and vectorizing glyphs for ${fontId}...`,
  });

  const coverage = await collectMinecraftGlyphs({
    resolver,
    version,
    fontId,
    ...(options.codepoints === undefined ? {} : { codepoints: options.codepoints }),
    ...(options.characters === undefined ? {} : { characters: options.characters }),
    ...(options.presets !== undefined ? { presets: options.presets } : options.preset !== undefined ? { preset: options.preset } : {}),
    missingGlyphPolicy: options.missingGlyphPolicy ?? "error",


    onProgress: (cur, tot) => {
      options.onProgress?.({
        stage: "glyph-collection",
        message: `Resolving glyph definitions for ${fontId}`,
        current: cur,
        total: tot,
      });
    },
  });


  options.onProgress?.({
    stage: "glyph-collection",
    message: `Collected ${coverage.glyphs.length} glyphs from Minecraft font definitions.`,
    total: coverage.glyphs.length,
  });

  const exportUnitsPerEm = configuredScale?.unitsPerEm
    ?? options.unitsPerEm
    ?? options.fontMetrics?.unitsPerEm;
  const fileSystem = dependencies.fileSystem ?? createDefaultFileSystem();
  try {
    await fileSystem.mkdir(outputDirectory, { recursive: true });
  } catch (error) {
    throw new BlockFontOutputError(outputDirectory, error);
  }

  // Pre-vectorize required styles ONCE for all requested formats and styles
  const stylesToVectorize = new Set<FontStyle>();
  if (formats.includes("ttc")) {
    const allStyles: readonly FontStyle[] = ["regular", "bold", "italic", "boldItalic"];
    const excludedSet = new Set(excludedStyles);
    for (const s of allStyles) {
      if (!excludedSet.has(s)) stylesToVectorize.add(s);
    }
  }
  for (const s of styles) {
    stylesToVectorize.add(s);
  }

  const styledByStyle = new Map<FontStyle, readonly StyledGlyph[]>();
  for (const style of stylesToVectorize) {
    let targetGlyphs = coverage.glyphs;
    if (targetGlyphs.length > 65534) {
      targetGlyphs = targetGlyphs.slice(0, 65534);
    }
    options.onProgress?.({
      stage: "font-building",
      message: `Vectorizing ${style} glyphs in parallel across worker threads...`,
      total: targetGlyphs.length,
    });
    const styled = await parallelStyleGlyphs(
      targetGlyphs,
      style,
      (cur, tot) => {
        options.onProgress?.({
          stage: "font-building",
          message: `Vectorizing ${style} glyphs (${cur}/${tot})`,
          current: cur,
          total: tot,
        });
      },
      exportUnitsPerEm,
    );
    styledByStyle.set(style, styled);
  }

  const fontOptions = {
    familyName,
    ...(exportUnitsPerEm === undefined ? {} : { unitsPerEm: exportUnitsPerEm }),
    ...(options.fontMetrics === undefined ? {} : { fontMetrics: options.fontMetrics }),
    ...(options.fontVersion === undefined ? {} : { version: options.fontVersion }),
    ...(options.copyright === undefined ? {} : { copyright: options.copyright }),
  };

  const files: BlockFontOutputFile[] = [];
  for (const format of formats) {
    if (format === "ttc") {
      const allStyles: readonly FontStyle[] = ["regular", "bold", "italic", "boldItalic"];
      const excludedSet = new Set(excludedStyles);
      const targetTtcStyles = allStyles.filter((s) => !excludedSet.has(s));
      if (targetTtcStyles.length === 0) {
        throw new InvalidBlockFontOptionsError("At least one style must be included in the TTC collection");
      }
      let bytes: Uint8Array;
      try {
        const fontList = targetTtcStyles.map((style) => {
          const styled = styledByStyle.get(style)!;
          const font = createOpenTypeFontFromStyled(styled, style, fontOptions);
          return { font, options: fontToTrueTypeOptions(font) };
        });
        const generated = serializeTrueTypeCollection(fontList);
        bytes = normalizeSfntTimestamps(generated);
      } catch (error) {
        throw new BlockFontGenerationError(
          `Unable to generate ttc font collection`,
          { style: "regular", format: "ttc", version, fontId },
          error,
        );
      }
      const fileName = `BlockFont-Complete.ttc`;
      const path = resolve(outputDirectory, fileName);
      try {
        await fileSystem.writeFile(path, bytes);
      } catch (error) {
        throw new BlockFontOutputError(path, error);
      }

      options.onProgress?.({
        stage: "writing-files",
        message: `Generated ${fileName} (${(bytes.length / 1024).toFixed(1)} KB)`,
      });

      files.push(Object.freeze({
        style: "regular",
        format: "ttc",
        fileName,
        path,
        bytes,
      }));
    } else {
      for (const style of styles) {
        let bytes: Uint8Array;
        try {
          const styled = styledByStyle.get(style)!;
          bytes = serializeStyledFontDeterministically(styled, style, format, fontOptions);
        } catch (error) {
          throw new BlockFontGenerationError(
            `Unable to generate ${style} ${format} font`,
            { style, format, version, fontId },
            error,
          );
        }
        const fileName = `BlockFont-${styleLabel(style)}.${format}`;
        const path = resolve(outputDirectory, fileName);
        try {
          await fileSystem.writeFile(path, bytes);
        } catch (error) {
          throw new BlockFontOutputError(path, error);
        }

        options.onProgress?.({
          stage: "writing-files",
          message: `Generated ${fileName} (${(bytes.length / 1024).toFixed(1)} KB)`,
        });

        files.push(Object.freeze({
          style,
          format,
          fileName,
          path,
          bytes,
        }));
      }
    }
  }

  const frozenFiles = Object.freeze(files);
  return Object.freeze({
    version,
    fontId,
    familyName,
    outputDirectory,
    styles,
    formats,
    codepoints: coverage.codepoints,
    glyphs: coverage.glyphs,
    missingCodepoints: coverage.missingCodepoints,
    files: frozenFiles,
    outputs: frozenFiles,
  });
}

/** Creates a generator with stable defaults while keeping dependencies injectable. */
export function createBlockFontGenerator(
  defaults: BlockFontGenerationOptions,
): BlockFontGenerator {
  return (options) => generateBlockFont({ ...defaults, ...options });
}

export const generateBlockFontFiles = generateBlockFont;
