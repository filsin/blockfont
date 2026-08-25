import { resolve, join } from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";
import { generateBlockFont } from "./pipeline/generate";
import type { CharacterPreset, FontStyle } from "./core";

/**
 * List of language presets to generate for releases.
 * Each language preset automatically includes 'ascii' and 'symbols'.
 */
const LANGUAGE_PRESETS: readonly CharacterPreset[] = [
  "ascii", // Baseline: ascii + symbols
  "latin",
  "cyrillic",
  "greek",
  "arabic",
  "hebrew",
  "devanagari",
  "thai",
  "korean",
  "japanese",
  "chinese",
];

const STYLES: readonly FontStyle[] = ["regular", "bold", "italic", "boldItalic"];

async function buildReleaseFonts(): Promise<void> {
  const rootOutputDir = resolve(process.cwd(), "release-fonts");
  console.log(`Starting optimized release fonts generation in ${rootOutputDir}...`);

  const startTime = Date.now();

  for (const preset of LANGUAGE_PRESETS) {
    const combinedPresets: CharacterPreset[] = preset === "ascii"
      ? ["ascii", "symbols"]
      : [preset, "ascii", "symbols"];

    console.log(`\n📦 Generating preset: "${preset}" (combining ${combinedPresets.join(", ")})...`);

    const tempDir = resolve(rootOutputDir, `_temp_${preset}`);

    // Single-pass generation: vectorizes glyphs ONCE for all 4 formats
    const result = await generateBlockFont({
      version: "1.21",
      presets: combinedPresets,
      outputDirectory: tempDir,
      styles: STYLES,
      formats: ["ttf", "otf", "woff", "ttc"],
    });

    // Re-organize generated files into preset/format/ hierarchy
    for (const file of result.files) {
      const targetDir = resolve(rootOutputDir, preset, file.format);
      await mkdir(targetDir, { recursive: true });
      await rename(file.path, join(targetDir, file.fileName));
    }

    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup errors
    }

    // Trigger garbage collection if exposed to keep heap memory low
    if (typeof globalThis.gc === "function") {
      try {
        globalThis.gc();
      } catch {
        // Ignore GC error
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Successfully generated all release font presets in ${rootOutputDir} (${elapsed}s)`);
}

buildReleaseFonts().catch((error) => {
  console.error("Failed to generate release fonts:", error);
  process.exitCode = 1;
});
