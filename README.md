# BlockFont

A parallelized TypeScript typography engine that vectorizes vanilla Minecraft asset definitions into sharp, production-ready OpenType font files (`.ttf`, `.otf`, `.woff`, `.ttc`).

---

## ✨ Features

- **Pixel-Perfect Vectorization**: Converts 8x8 Minecraft bitmap textures and GNU Unifont grids into clean, orthogonal vector contours without blur or subpixel artifacts.
- **4 Core Variants**: Generates `Regular` (weight 400), `Bold` (weight 700), `Italic` (shear 0.25), and `Bold Italic`.
- **TrueType Collections (.ttc)**: Multi-style container (`BlockFont-Complete.ttc`) natively supported by macOS, iOS, Windows, Adobe Photoshop, Figma, and Illustrator.
- **Vanilla Underline Metrics**: Native OpenType `post` metrics configured to match Minecraft's 1-pixel underline placement.
- **Character Presets & Custom Glyphs**: Select from built-in character sets (`ascii`, `latin`, `cyrillic`, `symbols`, CJK) and seamlessly inject custom Unicode scalars with deduplication.
- **CLI & Typesafe API**: Full command-line interface (`npx blockfont`) and programmatic TypeScript API (`createFont()`).

---

## 🚀 How to Use

### 1. Command Line Interface (CLI)

First, clone the repo and run `npm i` or `bun i`.
Generate fonts directly from your terminal:

```bash
# Generate a TrueType Collection (.ttc) containing all variants for Minecraft 1.21
npx blockfont generate ascii latin symbols -v 1.21 -o ./generated --format ttc

# Generate individual WOFF web fonts for all 4 styles
npx blockfont generate ascii latin -v 1.21 -o ./generated --style all --format woff

# Exclude specific styles from a TTC collection
npx blockfont generate ascii latin -v 1.21 -o ./generated --format ttc --exclude italic,bold-italic
```

### 2. Programmatic API (`createFont`)

Use `createFont()` in TypeScript or JavaScript:

```typescript
import { createFont } from "blockfont";

const font = createFont({
  path: "./generated",
  format: "ttc",
  styles: ["all"],
  characterSets: ["ascii", "latin", "symbols"],
  minecraftVersion: "26.whatever.mojang.will.come.up.with.atp", // used to download the assets
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

---

## 🌐 Web Integration

When serving BlockFont on the web, use `from-font` CSS properties to preserve 100% accurate Minecraft underline metrics:

```css
@font-face {
  font-family: 'BlockFont';
  src: url('./generated/BlockFont-Regular.woff') format('woff');
  font-weight: 400;
  font-style: normal;
}

textarea, body {
  font-family: 'BlockFont', monospace;
  font-synthesis: none;
  -webkit-font-smoothing: none;
  -moz-osx-font-smoothing: grayscale;
  /* Preserves 100% accurate Minecraft underline placement & thickness */
  text-underline-position: from-font;
  text-decoration-thickness: from-font;
  text-decoration-skip-ink: none; // optional, minecraft does not use it, but it's kinda beautiful, i'd keep skip-ink.
}
```

---

## 📚 Documentation

For in-depth guides, complete API reference, and technical specifications, explore the `docs/` folder:

- 📖 **[User Guide & API Reference](docs/how_to_use.md)** — Detailed CLI options, `createFont()` configuration, style exclusion rules, and web integration.
- ⚙️ **[Architecture & How It Works](docs/how_it_works.md)** — Provider resolution pipeline, vectorization algorithm, OpenType table serialization (`glyf`, `cmap`, `hhea`, `post`), and metric specifications.

---

I used AI in this project to fix ~~my terrible programming skills~~ the char spacing that wasn't faithful to minecraft's rendering, to help me support additional file formats, and to write the docs. I still don't know how to position myself ethically regarding AI.