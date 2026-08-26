import type {
  AssetSource,
  AssetStore,
} from "../assets";
import type {
  CharacterPreset,
  CoordinateScale,
  FontFormat,
  FontMetrics,
  FontStyle,
  MinecraftGlyph,
} from "../core";

import type { MinecraftFontDefinition } from "../providers";

/** Policy applied when an explicitly requested codepoint has no glyph. */
export type MissingGlyphPolicy = "error" | "skip";

/** Minimal resolver contract accepted by the orchestration layer. */
export interface BlockFontGlyphResolver {
  resolveGlyph(
    codepoint: number,
    fontId?: string,
    version?: string,
  ): Promise<MinecraftGlyph | undefined>;
  loadFont?(
    fontId?: string,
    version?: string,
  ): Promise<MinecraftFontDefinition>;
  readonly store?: AssetStore;
}

export interface BlockFontFileSystem {
  mkdir(path: string, options: { readonly recursive: true }): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

/** Injectable dependencies for offline, deterministic and test generation. */
export interface BlockFontDependencies {
  /** An already configured source of unpacked or downloaded assets. */
  readonly assetSource?: AssetSource;
  /** Alias for assetSource. */
  readonly source?: AssetSource;
  /** An already cached/readable asset store. */
  readonly assetStore?: AssetStore;
  /** Alias for assetStore. */
  readonly store?: AssetStore;
  /** A resolver substitute, useful for callers with their own asset system. */
  readonly resolver?: BlockFontGlyphResolver;
  /** Filesystem hooks; defaults to node:fs/promises. */
  readonly fileSystem?: BlockFontFileSystem;
}

export type GenerationProgressStage =
  | "assets-loading"
  | "glyph-collection"
  | "font-building"
  | "writing-files";

export interface GenerationProgress {
  readonly stage: GenerationProgressStage;
  readonly message: string;
  readonly current?: number;
  readonly total?: number;
}

export type OnProgressCallback = (progress: GenerationProgress) => void;

/** Public options accepted by generateBlockFont. */
export interface BlockFontGenerationOptions {
  /** Minecraft asset version, for example 1.21. */
  readonly version?: string;
  /** Alias retained for callers using the core terminology. */
  readonly minecraftVersion?: string;
  /** Root folder containing unpacked assets. */
  readonly assets?: string;
  /** Alias for assets. */
  readonly assetsDirectory?: string;
  /** Optional persistent cache around an injected/local source. */
  readonly cacheDirectory?: string;
  readonly assetSource?: AssetSource;
  readonly source?: AssetSource;
  readonly assetStore?: AssetStore;
  readonly store?: AssetStore;
  readonly fontId?: string;
  readonly output?: string;
  readonly outputDirectory?: string;
  readonly styles?: readonly FontStyle[];
  readonly style?: FontStyle;
  readonly formats?: readonly FontFormat[];
  readonly format?: FontFormat;
  readonly exclude?: FontStyle | readonly FontStyle[] | string;
  readonly excludes?: FontStyle | readonly FontStyle[] | string;
  readonly familyName?: string;
  /** Explicit coverage. A string is interpreted as a sequence of Unicode scalars. */
  readonly codepoints?: Iterable<number> | string;
  /** Alias for codepoints when the input is text. */
  readonly characters?: string;
  /** Optional character set preset filter or list of presets. */
  readonly preset?: CharacterPreset | readonly CharacterPreset[];
  readonly presets?: readonly CharacterPreset[];

  /** Missing requested glyphs fail by default; `skip` keeps them in the result diagnostics. */

  readonly missingGlyphPolicy?: MissingGlyphPolicy;
  readonly coordinateScale?: CoordinateScale;
  readonly scale?: CoordinateScale;
  readonly unitsPerEm?: number;
  /** OpenType name-table version, distinct from the Minecraft asset version. */
  readonly fontVersion?: string;
  readonly copyright?: string;
  readonly dependencies?: BlockFontDependencies;
  readonly resolver?: BlockFontGlyphResolver;
  /** Optional custom metrics; unitsPerEm must agree with it when both are set. */
  /** Optional path to an unzipped Minecraft Resource Pack directory or an AssetStore instance. */
  readonly resourcePack?: string | AssetStore;
  readonly resourcePackPath?: string | AssetStore;
  readonly pack?: string | AssetStore;
  readonly fontMetrics?: FontMetrics;
  /** Optional progress callback for stage notifications. */
  readonly onProgress?: OnProgressCallback;
}


export interface BlockFontOutputFile {
  readonly style: FontStyle;
  readonly format: FontFormat;
  readonly fileName: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface BlockFontGenerationResult {
  readonly version: string;
  readonly fontId: string;
  readonly familyName: string;
  readonly outputDirectory: string;
  readonly styles: readonly FontStyle[];
  readonly formats: readonly FontFormat[];
  readonly codepoints: readonly number[];
  readonly glyphs: readonly MinecraftGlyph[];
  /** Codepoints requested/discovered but not resolved by any provider. */
  readonly missingCodepoints: readonly number[];
  readonly files: readonly BlockFontOutputFile[];
  /** Alias convenient for clients that call generated files outputs. */
  readonly outputs: readonly BlockFontOutputFile[];
}

export interface GlyphCollectionResult {
  readonly codepoints: readonly number[];
  readonly glyphs: readonly MinecraftGlyph[];
  readonly missingCodepoints: readonly number[];
}

export type BlockFontGenerator = (
  options: BlockFontGenerationOptions,
) => Promise<BlockFontGenerationResult>;
