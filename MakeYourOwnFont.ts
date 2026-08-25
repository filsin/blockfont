import { createFont } from "./src/index";

/**
 * Example font configuration using the programmatic createFont() API.
 * Execute with: npx tsx MakeYourOwnFont.ts
 * 
 * It's the same as using the CLI. It's typesafe.
 */
const font = createFont({
  path: "./generated",
  format: "ttc",
  styles: ["all"], // For "ttc" collections, styles must be ["all"] or "all". Use exclude to omit styles.
  // exclude: ["boldItalic"],
  characterSets: [
    "ascii",
    "latin",
    "symbols",
  ],
  additionalChars: "★☆♠♣♥♦©®™АБВГ", // 'АБВГ' are Cyrillic characters added to ascii/latin/symbols
  minecraftVersion: "1.21",
});

console.log("Generating font using createFont() API...");

font()
  .catch(console.error)
  .then((result) => {
    if (result) {
      console.log(`Successfully generated ${result.files.length} font file(s) in ${result.outputDirectory}`);
    }
  });
