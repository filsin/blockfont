import { resolve } from "node:path";
import { generateBlockFont } from "./pipeline/generate";
import type { CharacterPreset, FontFormat, FontStyle } from "./core";

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

const FORMATS: readonly FontFormat[] = ["ttf", "otf", "woff", "ttc"];
const STYLES: readonly FontStyle[] = ["regular", "bold", "italic", "boldItalic"];

async function buildReleaseFonts(): Promise<void> {
  const rootOutputDir = resolve(process.cwd(), "release-fonts");
  console.log(`Starting parallel release fonts generation in ${rootOutputDir}...`);

  await Promise.all(
    LANGUAGE_PRESETS.map(async (preset) => {
      const combinedPresets: CharacterPreset[] = preset === "ascii"
        ? ["ascii", "symbols"]
        : [preset, "ascii", "symbols"];

      console.log(`📦 Generating preset: "${preset}" (combining ${combinedPresets.join(", ")})...`);

      for (const format of FORMATS) {
        const outputDirectory = resolve(rootOutputDir, preset, format);

        if (format === "ttc") {
          await generateBlockFont({
            version: "1.21",
            presets: combinedPresets,
            outputDirectory,
            formats: ["ttc"],
          });
        } else {
          await generateBlockFont({
            version: "1.21",
            presets: combinedPresets,
            outputDirectory,
            styles: STYLES,
            formats: [format],
          });
        }
      }
    }),
  );

  console.log(`\n✅ Successfully generated all release font presets in ${rootOutputDir}`);
}

buildReleaseFonts().catch((error) => {
  console.error("Failed to generate release fonts:", error);
  process.exitCode = 1;
});
