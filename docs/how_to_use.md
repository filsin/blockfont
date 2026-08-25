# BlockFont - User Guide & API Reference

**BlockFont** is a TypeScript generator that creates OpenType font files (`.ttf`, `.otf`, `.woff`, `.ttc`) faithful to the vanilla Minecraft font renderer.

It provides a programmatic API (`createFont()`), a CLI (`npx blockfont`), and high-performance multi-threaded vectorization.

---

## Table of Contents

- [Quick Start](#quick-start)
  - [1. CLI Usage](#1-cli-usage)
  - [2. Programmatic API](#2-programmatic-api)
- [Key Features](#key-features)
- [TrueType Collections (.ttc) & Exclude Option](#truetype-collections-ttc--exclude-option)
- [Web Integration (`test.html`)](#web-integration-testhtml)
- [Supported Formats & Styles](#supported-formats--styles)

---

## Quick Start

### 1. CLI Usage

Generate fonts directly from your terminal:

```bash
# Generate all individual font styles in TTF, OTF, and WOFF formats
npx blockfont generate ascii latin symbols -v 26.2 -o ./generated --style all --format woff

# Generate a TrueType Collection (.ttc) containing all styles
npx blockfont generate ascii latin -v 26.2 -o ./generated --format ttc

# Generate a TrueType Collection excluding italic and bold-italic styles
npx blockfont generate ascii latin -v 26.2 -o ./generated --format ttc --exclude italic,bold-italic
```

#### CLI Flags:
* `-v, --minecraft-version <version>`: Minecraft version to resolve assets for (e.g. `26.2`, `1.21`).
* `-o, --output <directory>`: Output directory for generated font files (default: `./generated`).
* `-s, --style <style>`: Font styles to generate (`regular`, `bold`, `italic`, `boldItalic`, or `all`).
* `-f, --format <format>`: Output binary formats (`ttf`, `otf`, `woff`, `ttc`, or `all`).
* `-e, --exclude <style>`: Styles to exclude from `.ttc` collection (only valid when format includes `ttc`).
* `-c, --characters <text>`: Additional individual characters to include in the generated font.

---

### 2. Programmatic API

You can declare typesafe font generations using `createFont()` in TypeScript or JavaScript:

```typescript
import { createFont } from "blockfont";

const font = createFont({
  path: "./generated",
  format: "ttf", // "ttf" | "otf" | "woff" | "ttc" | "all"
  styles: ["regular", "bold"], // Valid options are ["regular", "bold", "italic", "boldItalic"] or ["all"]
  characterSets: ["ascii", "latin", "symbols"],
  additionalChars: "★☆♠♣♥♦©®™АБВГ",
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
```

TTC is a format collection that gathers every styles, therefore the only valid option for `styles` is ["all"]

---

## Key Features

- **Pixel-Perfect Vectorization**: Converts 8x8 Minecraft textures into sharp vector contours without blur or anti-aliasing artifacts.
- **4 Core Variants**: `Regular` (weight 400), `Bold` (weight 700), `Italic` (shear 0.25), and `Bold Italic`.
- **TrueType Collection (.ttc)**: Multi-style collection container (`BlockFont-Complete.ttc`) natively supported by macOS, iOS, Windows, Photoshop, and Figma.
- **Selecting and combining charsets**: You can select exactly what charsets you want to use, and combine them with additional characters.
- **Minecraft Underline Metrics**: Native OpenType `post` underline metrics (`§n`) configured to match Minecraft's 1-pixel underline placement.

---

## TrueType Collections (.ttc) & Exclude Option

The `ttc` format packages subfont variants into a single `.ttc` file (`BlockFont-Complete.ttc`).

- **Strict Style Rules**: When `format: "ttc"`, the `styles` parameter **must** be `"all"` or `["all"]` (or omitted). Specifying individual style arrays like `styles: ["bold"]` will trigger TypeScript compiler errors and runtime validation failures.
- **Excluding Styles**: Use `exclude: ["italic", "boldItalic"]` (CLI: `-e italic,bold-italic`) to omit specific variants from the collection.
- *Validation Rule*: The `exclude` option is strictly reserved for `ttc` collections. Using `exclude` with non-TTC formats will throw an `InvalidBlockFontOptionsError`.

---

## Web Integration (`test.html`)

When using BlockFont on the web via CSS `@font-face`, use the following CSS rules for accurate pixel-art underline rendering:

```css
@font-face {
  font-family: 'BlockFont';
  src: url('./generated/BlockFont-Regular.woff') format('woff');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'BlockFont';
  src: url('./generated/BlockFont-Bold.woff') format('woff');
  font-weight: 700;
  font-style: normal;
}

textarea, body {
  font-family: 'BlockFont', monospace;
  font-synthesis: none;
  -webkit-font-smoothing: none;
  -moz-osx-font-smoothing: grayscale;
  text-underline-position: from-font;
  text-decoration-thickness: from-font;
  text-decoration-skip-ink: none;
}
```

Notice the `text-underline-position` and `text-decoration-thickness` CSS properties. These are used to make sure CSS doesn't override the font's underline position and thickness which are 100% accurate to the vanilla Minecraft font.

---

## Supported Formats & Styles

| Option | Values | Description |
| :--- | :--- | :--- |
| `--style` / `styles` | `regular`, `bold`, `italic`, `bold-italic`, `all` | Individual style files to generate. For TTC, must be `all`. |
| `--format` / `format` | `ttf`, `otf`, `woff`, `ttc`, `all` | Target OpenType font file formats. |
| `--exclude` / `exclude` | `regular`, `bold`, `italic`, `bold-italic` | Styles to exclude from `.ttc` collection. |
| Preset / `characterSets` | `ascii`, `latin`, `symbols`, ... | Built-in character sets for Minecraft font definitions. |
