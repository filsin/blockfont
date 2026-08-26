import type { AssetStore } from "../assets/asset-store";
import type { MinecraftGlyph } from "../core/minecraft-glyph";
import { DEFAULT_COORDINATE_SCALE } from "../core";
import { BitmapGlyphProvider } from "./bitmap-provider";
import { LegacyUnicodeProvider } from "./legacy-unicode-provider";

/** Standard ASCII character matrix used in Minecraft 1.8–1.12.2 ascii.png */
export const LEGACY_ASCII_CHARS: readonly string[] = [
  "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000",
  "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000",
  " !\"#$%&'()*+,-./",
  "0123456789:;<=>?",
  "@ABCDEFGHIJKLMNO",
  "PQRSTUVWXYZ[\\]^_",
  "`abcdefghijklmno",
  "pqrstuvwxyz{|}~\u0000",
  "ÇüéâäàåçêëèïîìÄÅ",
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ",
  "áíóúñÑªº¿®¬½¼¡«»",
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐",
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧",
  "╨╤╥╙╘╒Ⓢ╫╪┘┌█▄▌▐▀",
  "αβΓπΣσμτΦΘΩδ∞∅∈∩",
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0",
];

/**
 * Loads Minecraft 1.8–1.12.2 fonts (Legacy era without font/*.json files).
 */
export class LegacyFontLoader {
  async loadGlyphs(context: {
    readonly store: AssetStore;
    readonly version: string;
    readonly characters?: ReadonlySet<number> | undefined;
  }): Promise<readonly MinecraftGlyph[]> {
    const { store, version, characters } = context;

    const dummyContext = {
      version,
      store,
      scale: DEFAULT_COORDINATE_SCALE,
      resolveFontGlyph: async () => undefined,
    };

    const glyphMap = new Map<number, MinecraftGlyph>();

    const targetCodepoints = characters !== undefined
      ? Array.from(characters)
      : Array.from({ length: 65536 }, (_, i) => i);

    // 1. Try loading ascii.png bitmap provider
    const asciiProvider = new BitmapGlyphProvider(
      {
        type: "bitmap",
        file: "minecraft:textures/font/ascii.png",
        height: 8,
        ascent: 7,
        chars: LEGACY_ASCII_CHARS,
      },
      dummyContext,
    );

    for (const cp of targetCodepoints) {
      if (cp <= 0x7f) {
        try {
          const glyph = await asciiProvider.resolve(cp);
          if (glyph !== undefined) {
            glyphMap.set(cp, glyph);
          }
        } catch {
          // Ignored
        }
      }
    }

    // 2. Load Legacy Unicode pages (unicode_page_XX.png + glyph_sizes.bin)
    const legacyUnicodeProvider = new LegacyUnicodeProvider({
      sizesResource: "minecraft:font/glyph_sizes.bin",
      templateResource: "minecraft:textures/font/unicode_page_%s.png",
      store,
      version,
    });

    for (const cp of targetCodepoints) {
      if (!glyphMap.has(cp) && cp <= 0xffff) {
        try {
          const glyph = await legacyUnicodeProvider.resolve(cp);
          if (glyph !== undefined) {
            glyphMap.set(cp, glyph);
          }
        } catch {
          // Ignored
        }
      }
    }

    return Array.from(glyphMap.values());
  }
}
