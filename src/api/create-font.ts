import { generateBlockFont } from "../pipeline/generate";
import type { BlockFontGenerationResult } from "../pipeline/types";
import { isCodepointInPresets } from "../pipeline/presets";
import type { FontFormat, FontStyle } from "../core/generation";


import { InvalidBlockFontOptionsError } from "../pipeline/errors";

import type { AssetStore } from "../assets";

/** Supported character set presets for programmatic font generation (excludes "all"). */
export type CharacterSet =
  | "ascii"
  | "latin"
  | "cyrillic"
  | "greek"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "thai"
  | "korean"
  | "japanese"
  | "chinese"
  | "symbols";

/** Style configuration option for font generation. */
export type FontStyleOption = "all" | readonly ("regular" | "bold" | "italic" | "boldItalic" | "all")[];

export type BaseFontConfig = {
  /** Output directory path for generated font files. */
  path: string;
  /** Targeted character set presets. */
  characterSets: readonly CharacterSet[];
  /** Minecraft asset version (e.g. "1.21" or "26.2"). Optional if resourcePack is provided with a valid pack.mcmeta. */
  minecraftVersion?: string;
  /** Optional Resource Pack directory path or custom AssetStore instance to overlay custom textures onto base assets. */
  resourcePack?: string | AssetStore;
  /** Optional custom characters string to include alongside presets. */
  additionalChars?: string;
};

export type TtcFontConfig = BaseFontConfig & {
  /** Export format is "ttc". */
  format: "ttc";
  /** For TTC collections, styles must be "all" or ["all"] (or omitted). */
  styles?: "all" | readonly ["all"];
  /** Styles to exclude from TTC collection. */
  exclude?: FontStyle | readonly FontStyle[];
};

export type NonTtcFontConfig = BaseFontConfig & {
  /** Export format ("woff", "otf", "ttf", or "all"). */
  format?: "woff" | "otf" | "ttf" | "all";
  /** Targeted styles ("all" for all 4 styles, or array of individual styles). */
  styles?: FontStyleOption;
  /** "exclude" is not allowed when format is not "ttc". */
  exclude?: never;
};

/** Typesafe configuration options for programmatic createFont() declaration. */
export type FontConfig = TtcFontConfig | NonTtcFontConfig;

/** Deduplicates custom characters against specified character set presets. */
export function deduplicateAdditionalCharacters(
  additionalChars: string | undefined,
  characterSets: readonly CharacterSet[],
): {
  readonly newCharacters: string;
  readonly newCodepoints: readonly number[];
  readonly alreadyCoveredCount: number;
} {
  if (!additionalChars || additionalChars.length === 0) {
    return { newCharacters: "", newCodepoints: [], alreadyCoveredCount: 0 };
  }

  const codepoints = Array.from(additionalChars).map((char) => char.codePointAt(0)!);
  const uniqueCodepoints = Array.from(new Set(codepoints));

  const newCodepoints: number[] = [];
  let alreadyCoveredCount = 0;

  for (const cp of uniqueCodepoints) {
    if (isCodepointInPresets(cp, characterSets)) {
      alreadyCoveredCount++;
    } else {
      newCodepoints.push(cp);
    }
  }

  const newCharacters = String.fromCodePoint(...newCodepoints);
  return { newCharacters, newCodepoints, alreadyCoveredCount };
}

/**
 * Creates a typesafe font generation function.
 *
 * @example
 * ```ts
 * const font = createFont({
 *   path: "./generated",
 *   styles: "all",
 *   characterSets: ["ascii", "latin", "symbols"],
 *   format: "ttc",
 *   additionalChars: "★☆♠♣♥♦©®™",
 *   minecraftVersion: "1.21",
 * });
 *
 * await font();
 * ```
 */
export function createFont(config: FontConfig): () => Promise<BlockFontGenerationResult> {
  return async function font(): Promise<BlockFontGenerationResult> {
    if (config.format === "ttc" && config.styles !== undefined) {
      const isAll = config.styles === "all" || (Array.isArray(config.styles) && config.styles.length === 1 && config.styles[0] === "all");
      if (!isAll) {
        throw new InvalidBlockFontOptionsError(
          'For "ttc" format fonts, "styles" must be "all" or ["all"]. Use "exclude" to omit specific styles from the collection.',
        );
      }
    }

    const { newCharacters, newCodepoints, alreadyCoveredCount } = deduplicateAdditionalCharacters(
      config.additionalChars,
      config.characterSets,
    );

    let styles: readonly FontStyle[];
    if (config.styles === "all" || (Array.isArray(config.styles) && config.styles.includes("all"))) {
      styles = ["regular", "bold", "italic", "boldItalic"];
    } else if (config.styles !== undefined) {
      styles = config.styles.filter((s): s is FontStyle => s !== "all");
    } else {
      styles = ["regular", "bold", "italic", "boldItalic"];
    }

    let formats: readonly FontFormat[];
    if (config.format === "all") {
      formats = ["ttf", "otf", "woff", "ttc"];
    } else if (config.format !== undefined) {
      formats = [config.format as FontFormat];
    } else {
      formats = ["woff"];
    }

    const result = await generateBlockFont({
      ...(config.minecraftVersion !== undefined ? { version: config.minecraftVersion } : {}),
      ...(config.resourcePack !== undefined ? { resourcePack: config.resourcePack } : {}),
      outputDirectory: config.path,
      presets: config.characterSets,
      ...(newCharacters.length > 0 ? { characters: newCharacters } : {}),
      styles,
      formats,
      ...(config.exclude !== undefined ? { exclude: config.exclude } : {}),
    });

    if (newCodepoints.length > 0) {
      console.log(
        `blockfont: Added ${newCodepoints.length} additional custom character(s) to compiled font: "${newCharacters}"` +
        (alreadyCoveredCount > 0 ? ` (${alreadyCoveredCount} were already covered by presets)` : ""),
      );
    } else if (config.additionalChars && config.additionalChars.length > 0) {
      console.log(
        `blockfont: All ${alreadyCoveredCount} additional custom character(s) were already included in the selected characterSets.`,
      );
    }

    return result;
  };
}
