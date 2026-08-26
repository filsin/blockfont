#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command, CommanderError } from "commander";

import {
  generateBlockFont,
  type BlockFontGenerationOptions,
  type CharacterPreset,
  type FontFormat,
  type FontStyle,
  type MissingGlyphPolicy,
} from "../index";
import { generateZshCompletion } from "./completion";

const PACKAGE_VERSION_FALLBACK = "0.1.0";

function packageVersion(): string {
  try {
    const packagePath = join(dirname(__filename), "../../package.json");
    const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const version = parsed.version;
      if (typeof version === "string" && version.length > 0) return version;
    }
  } catch {
    // Fallback
  }
  return PACKAGE_VERSION_FALLBACK;
}

const STYLE_ALIASES: Readonly<Record<string, FontStyle | "all">> = Object.freeze({
  regular: "regular",
  normal: "regular",
  bold: "bold",
  italic: "italic",
  "bold-italic": "boldItalic",
  bolditalic: "boldItalic",
  all: "all",
});

const FORMAT_ALIASES: Readonly<Record<string, FontFormat | "all">> = Object.freeze({
  ttf: "ttf",
  otf: "otf",
  woff: "woff",
  ttc: "ttc",
  all: "all",
});

const MISSING_GLYPH_POLICIES: Readonly<Record<string, MissingGlyphPolicy>> = Object.freeze({
  error: "error",
  skip: "skip",
});

const PRESET_ALIASES: Readonly<Record<string, CharacterPreset>> = Object.freeze({
  ascii: "ascii",
  latin: "latin",
  cyrillic: "cyrillic",
  greek: "greek",
  arabic: "arabic",
  hebrew: "hebrew",
  devanagari: "devanagari",
  thai: "thai",
  korean: "korean",
  japanese: "japanese",
  chinese: "chinese",
  symbols: "symbols",
  emojis: "emojis",
  emoji: "emojis",
  all: "all",
});

function parsePresets(values: readonly string[]): readonly CharacterPreset[] {
  const result: CharacterPreset[] = [];
  const seen = new Set<CharacterPreset>();
  for (const raw of values) {
    const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (items.length === 0) throw new Error("--preset expects non-empty values");
    for (const value of items) {
      const normalized = PRESET_ALIASES[value.toLowerCase()];
      if (normalized === undefined) {
        throw new Error(
          `Unsupported preset "${value}". Available presets: ${Object.keys(PRESET_ALIASES).join(", ")}`,
        );
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
  }
  return Object.freeze(result);
}

function collectList(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseStyles(values: readonly string[]): readonly FontStyle[] {
  const result: FontStyle[] = [];
  const seen = new Set<FontStyle>();
  for (const raw of values) {
    const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (items.length === 0) throw new Error("--style expects non-empty values");
    for (const value of items) {
      const normalized = STYLE_ALIASES[value.toLowerCase()];
      if (normalized === undefined) {
        throw new Error(
          `Unsupported style "${value}". Expected regular, bold, italic, bold-italic, or all`,
        );
      }
      if (normalized === "all") {
        const allStyles: readonly FontStyle[] = ["regular", "bold", "italic", "boldItalic"];
        for (const st of allStyles) {
          if (!seen.has(st)) {
            seen.add(st);
            result.push(st);
          }
        }
      } else {
        if (seen.has(normalized)) throw new Error(`Duplicate style: ${value}`);
        seen.add(normalized);
        result.push(normalized);
      }
    }
  }
  return Object.freeze(result);
}

function parseExcludeStyles(values: readonly string[]): readonly FontStyle[] {
  const result: FontStyle[] = [];
  const seen = new Set<FontStyle>();
  for (const raw of values) {
    const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const value of items) {
      const normalized = STYLE_ALIASES[value.toLowerCase()];
      if (normalized === undefined || normalized === "all") {
        throw new Error(
          `Unsupported exclude style "${value}". Expected regular, bold, italic, or bold-italic`,
        );
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
  }
  return Object.freeze(result);
}

function parseFormats(values: readonly string[]): readonly FontFormat[] {
  const result: FontFormat[] = [];
  const seen = new Set<FontFormat>();
  for (const raw of values) {
    const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (items.length === 0) throw new Error("--format expects non-empty values");
    for (const value of items) {
      const normalized = FORMAT_ALIASES[value.toLowerCase()];
      if (normalized === undefined) {
        throw new Error(`Unsupported format "${value}". Expected ttf, otf, woff, ttc, or all`);
      }
      if (normalized === "all") {
        const allFormats: readonly FontFormat[] = ["ttf", "otf", "woff", "ttc"];
        for (const fmt of allFormats) {
          if (!seen.has(fmt)) {
            seen.add(fmt);
            result.push(fmt);
          }
        }
      } else {
        if (seen.has(normalized)) throw new Error(`Duplicate format: ${value}`);
        seen.add(normalized);
        result.push(normalized);
      }
    }
  }
  return Object.freeze(result);
}

function parseMissingGlyphPolicy(value: string): MissingGlyphPolicy {
  const normalized = MISSING_GLYPH_POLICIES[value.toLowerCase()];
  if (normalized === undefined) {
    throw new Error(
      `Unsupported missing glyph policy "${value}". Expected error or skip`,
    );
  }
  return normalized;
}

interface CliOptions {
  version?: string;
  minecraftVersion?: string;
  mcVersion?: string;
  resourcePack?: string;
  pack?: string;
  assets?: string;
  output?: string;
  font?: string;
  format?: string[];
  style?: string[];
  exclude?: string[];
  preset?: string[];
  characters?: string;
  codepoints?: string;
  missingGlyphs?: string;
  singleFont?: boolean;
  merged?: boolean;
}

let lastExitCode = 0;

async function executeGeneration(opts: CliOptions, topLevelPresets: string[]): Promise<number> {
  try {
    const rawPresets = [...topLevelPresets, ...(opts.preset ?? [])];
    const rawVersion = opts.version ?? opts.minecraftVersion ?? opts.mcVersion;

    const isVersionFlagQuery = (rawVersion as unknown) === true || (typeof rawVersion === "string" && rawVersion.trim().length === 0);
    const isNoArgs =
      !rawVersion &&
      !opts.assets &&
      !opts.output &&
      !opts.font &&
      (!opts.format || opts.format.length === 0) &&
      (!opts.style || opts.style.length === 0) &&
      (!opts.exclude || opts.exclude.length === 0) &&
      (!opts.characters) &&
      (!opts.codepoints) &&
      rawPresets.length === 0;

    if (isVersionFlagQuery || isNoArgs) {
      console.log(`blockfont v${packageVersion()}`);
      return 0;
    }

    const packPath = opts.resourcePack ?? opts.pack;
    const minecraftVersion = typeof rawVersion === "string" ? rawVersion : (packPath !== undefined ? undefined : "26.2");
    if (!opts.output) {
      console.error("blockfont: Missing required option '-o, --output <path>'");
      return 1;
    }

    let presets: readonly CharacterPreset[] | undefined;
    if (rawPresets.length > 0) {
      presets = parsePresets(rawPresets);
    }

    let formats: readonly FontFormat[] | undefined;
    if (opts.format && opts.format.length > 0) {
      formats = parseFormats(opts.format);
    }

    let exclude: readonly FontStyle[] | undefined;
    if (opts.exclude && opts.exclude.length > 0) {
      exclude = parseExcludeStyles(opts.exclude);
      const effectiveFormats = formats ?? ["ttf"];
      if (!effectiveFormats.includes("ttc")) {
        console.error('blockfont: The "exclude" option is only supported when generating "ttc" format fonts.');
        return 1;
      }
    }

    let styles: readonly FontStyle[] | undefined;
    if (opts.style && opts.style.length > 0) {
      styles = parseStyles(opts.style);
    }

    let missingGlyphPolicy: MissingGlyphPolicy | undefined;
    if (opts.missingGlyphs) {
      missingGlyphPolicy = parseMissingGlyphPolicy(opts.missingGlyphs);
    }

    let isLastTTY = false;
    const options: BlockFontGenerationOptions = {
      ...(minecraftVersion === undefined ? {} : { version: minecraftVersion }),
      ...(packPath === undefined ? {} : { resourcePack: packPath }),
      assets: opts.assets ?? "./assets",
      outputDirectory: opts.output,
      ...(opts.font === undefined ? {} : { fontId: opts.font }),
      ...(styles === undefined ? {} : { styles }),
      ...(formats === undefined ? {} : { formats }),
      ...(exclude === undefined ? {} : { exclude }),
      ...(presets === undefined ? {} : { presets }),
      ...(opts.characters === undefined ? {} : { characters: opts.characters }),
      ...(opts.codepoints === undefined ? {} : { codepoints: opts.codepoints }),
      ...(missingGlyphPolicy === undefined ? {} : { missingGlyphPolicy }),
      onProgress: (p) => {
        let msg = p.message;
        if (p.current !== undefined && p.total !== undefined && p.total > 0) {
          const pct = Math.floor((p.current / p.total) * 100);
          msg = `${p.message} [${p.current}/${p.total} glyphes] (${pct}%)`;
        }
        if (process.stdout.isTTY) {
          process.stdout.write(`\r\x1b[Kblockfont: ${msg}`);
          isLastTTY = true;
          if (p.current !== undefined && p.total !== undefined && p.current >= p.total) {
            process.stdout.write("\n");
            isLastTTY = false;
          }
        } else {
          console.log(`blockfont: ${msg}`);
        }
      },
    };

    const result = await generateBlockFont(options);
    if (isLastTTY) process.stdout.write("\n");
    console.log(`Generated ${result.files.length} font files in ${opts.output}`);
    return 0;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`blockfont: ${error.message}`);
    } else {
      console.error("blockfont: An unexpected error occurred");
    }
    return 1;
  }
}

export function buildProgram(): Command {
  lastExitCode = 0;
  const program = new Command();

  program
    .name("blockfont")
    .description("High-performance vector typography pipeline for Minecraft asset definitions")
    .version(packageVersion(), "-V, --package-version", "Print npm package version");

  // Options for top-level generation
  program
    .arguments("[topLevelPresets...]")
    .option("-v, --version [version]", "Print BlockFont version, or set Minecraft asset version")
    .option("--minecraft-version <version>", "Set Minecraft asset version")
    .option("--mc-version <version>", "Set Minecraft asset version")
    .option("-r, --resource-pack <path>", "Path to unzipped Minecraft Resource Pack directory containing pack.mcmeta")
    .option("--pack <path>", "Alias for --resource-pack")
    .option("-a, --assets <path>", "Root directory for Minecraft assets (default: ./assets)")
    .option("-o, --output <path>", "Directory where generated fonts are written")
    .option("-F, --font <id>", "Font id to resolve (default: minecraft:default)")
    .option("-f, --format <format>", "ttf, otf, woff, ttc, or all; comma-separated or repeatable (default: ttf)", collectList, [])
    .option("-s, --style <style>", "regular, bold, italic, bold-italic, or all; comma-separated or repeatable", collectList, [])
    .option("-e, --exclude <style>", "Styles to exclude from TTC collection (regular, bold, italic, bold-italic); comma-separated or repeatable", collectList, [])
    .option("-p, --preset <preset>", "Character set preset(s): ascii, latin, cyrillic, greek, arabic, hebrew, devanagari, thai, korean, japanese, chinese, symbols, all", collectList, [])
    .option("-c, --characters <text>", "Explicit characters to include in the font")
    .option("--codepoints <list>", "Explicit codepoint list or string")
    .option("-m, --missing-glyphs <policy>", "error or skip (default: error)")
    .action(async (topLevelPresets, opts) => {
      lastExitCode = await executeGeneration(opts, Array.isArray(topLevelPresets) ? topLevelPresets : []);
    });

  // Subcommand: generate [positionalPresets...]
  program
    .command("generate [positionalPresets...]")
    .description("Generate font files for targeted character presets (e.g. blockfont generate latin cyrillic)")
    .option("-v, --version <version>", "Minecraft asset version (e.g. 1.21)")
    .option("--minecraft-version <version>", "Minecraft asset version")
    .option("-r, --resource-pack <path>", "Path to unzipped Minecraft Resource Pack directory containing pack.mcmeta")
    .option("--pack <path>", "Alias for --resource-pack")
    .option("-a, --assets <path>", "Root directory for Minecraft assets (default: ./assets)")
    .option("-o, --output <path>", "Directory where generated fonts are written")
    .option("-F, --font <id>", "Font id to resolve (default: minecraft:default)")
    .option("-f, --format <format>", "ttf, otf, woff, ttc, or all; comma-separated or repeatable", collectList, [])
    .option("-s, --style <style>", "regular, bold, italic, bold-italic, or all; comma-separated or repeatable", collectList, [])
    .option("-e, --exclude <style>", "Styles to exclude from TTC collection (regular, bold, italic, bold-italic); comma-separated or repeatable", collectList, [])
    .option("-p, --preset <preset>", "Repeatable/comma-separated presets", collectList, [])
    .option("-c, --characters <text>", "Explicit characters to include")
    .option("--codepoints <list>", "Explicit codepoint list or string")
    .option("-m, --missing-glyphs <policy>", "error or skip")
    .action(async (positionalPresets, opts, cmd) => {
      const parentOpts = cmd?.parent ? cmd.parent.opts() : {};
      const formatList = (opts.format && opts.format.length > 0)
        ? opts.format
        : (parentOpts.format && parentOpts.format.length > 0 ? parentOpts.format : undefined);

      const styleList = (opts.style && opts.style.length > 0)
        ? opts.style
        : (parentOpts.style && parentOpts.style.length > 0 ? parentOpts.style : undefined);

      const excludeList = (opts.exclude && opts.exclude.length > 0)
        ? opts.exclude
        : (parentOpts.exclude && parentOpts.exclude.length > 0 ? parentOpts.exclude : undefined);

      const mergedOpts = {
        ...parentOpts,
        ...opts,
        ...(formatList ? { format: formatList } : {}),
        ...(styleList ? { style: styleList } : {}),
        ...(excludeList ? { exclude: excludeList } : {}),
      };
      const presets = Array.isArray(positionalPresets) ? positionalPresets : [];
      lastExitCode = await executeGeneration(mergedOpts, presets);
    });

  // Subcommand: presets / list
  program
    .command("presets")
    .alias("list")
    .description("List available character set presets, ranges, and sizes")
    .action(() => {
      console.log(`\nBlockFont Character Set Presets:\n`);
      console.log(`  preset       glyphs   woff size   description`);
      console.log(`  ----------   ------   ---------   ------------------------------------------`);
      console.log(`  ascii        95       8.2 KB      Basic 128 ASCII characters (U+0020..U+007E)`);
      console.log(`  latin        816      77.4 KB     All European Latin alphabets + accents`);
      console.log(`  cyrillic     399      36.6 KB     Cyrillic alphabet (Russian, Ukrainian...)`);
      console.log(`  greek        235      22.0 KB     Greek alphabet (U+0370..U+03FF)`);
      console.log(`  arabic       256      24.0 KB     Arabic script`);
      console.log(`  hebrew       133      13.0 KB     Hebrew script`);
      console.log(`  devanagari   128      12.0 KB     Devanagari (Hindi, Sanskrit...)`);
      console.log(`  thai         87       9.0 KB      Thai script`);
      console.log(`  korean       11,173   780.0 KB    Korean Hangul syllables`);
      console.log(`  japanese     11,630   305.8 KB    Japanese Hiragana, Katakana, Kanji`);
      console.log(`  chinese      21,151   1.48 MB     Chinese CJK Unified Ideographs`);
      console.log(`  symbols      3,072    260.0 KB    Math, Braille, Box drawing, Technical, Arrows`);
      console.log(`  emojis       1,500    140.0 KB    Emojis & Miscellaneous Symbols/Pictographs`);
      console.log(`  all          114,581  862.0 KB    Full Minecraft discovery (capped to 8k for merged)\n`);
      lastExitCode = 0;
    });

  // Subcommand: completion [shell]
  program
    .command("completion [shell]")
    .description("Generate ZSH completion script for zsh-autocomplete / fpath")
    .action(() => {
      console.log(generateZshCompletion());
      lastExitCode = 0;
    });

  program.exitOverride();

  return program;
}

/** Runs CLI execution. Exported for tests. */
export async function runCli(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const program = buildProgram();

  program.configureOutput({
    writeOut: (str) => console.log(str.trimEnd()),
    writeErr: (str) => {
      const cleaned = str.trimEnd().replace(/^error:\s*/i, "blockfont: Unknown option ");
      console.error(cleaned);
    },
  });

  lastExitCode = 0;

  try {
    await program.parseAsync(args, { from: "user" });
    return lastExitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return 0;
      if (error.code === "commander.helpDisplayed" || error.code === "commander.help") {
        return 0;
      }
      console.error("Use --help for usage.");
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`blockfont: ${message}`);
    console.error("Use --help for usage.");
    return 2;
  }
}

if (require.main === module) {
  runCli().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`blockfont: ${message}`);
    process.exitCode = 1;
  });
}
