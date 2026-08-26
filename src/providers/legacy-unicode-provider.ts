import { PNG } from "pngjs";
import type { AssetStore } from "../assets/asset-store";
import { parseResourceLocation, type ResourceLocationInput } from "../assets/resource-location";
import { createMinecraftGlyph, type MinecraftGlyph } from "../core/minecraft-glyph";
import type { GlyphProvider } from "./provider-utils";
import { createSourcePixelContour } from "./provider-utils";
import { DEFAULT_COORDINATE_SCALE } from "../core";

export interface LegacyUnicodeProviderOptions {
  readonly sizesResource?: ResourceLocationInput | undefined;
  readonly templateResource?: string | undefined;
  readonly store?: AssetStore | undefined;
  readonly version?: string | undefined;
}

/**
 * Parses Legacy Minecraft Unicode pages (glyph_sizes.bin + unicode_page_XX.png)
 * used in Minecraft 1.8 through 1.19.4.
 */
export class LegacyUnicodeProvider implements GlyphProvider {
  readonly type = "legacy_unicode";
  private readonly sizesResource: ResourceLocationInput;
  private readonly templateResource: string;
  private readonly store: AssetStore | undefined;
  private readonly version: string | undefined;

  private sizesBuffer?: Uint8Array;
  private readonly pageCache = new Map<number, PNG | null>();

  constructor(options?: LegacyUnicodeProviderOptions) {
    this.sizesResource = options?.sizesResource ?? "minecraft:font/glyph_sizes.bin";
    this.templateResource = options?.templateResource ?? "minecraft:font/unicode_page_%s.png";
    this.store = options?.store;
    this.version = options?.version;
  }

  async resolve(codepoint: number, _stack?: readonly string[]): Promise<MinecraftGlyph | undefined> {
    if (codepoint > 0xffff) return undefined;
    const page = codepoint >> 8;
    const tileIdx = codepoint & 0xff;

    if (this.store === undefined || this.version === undefined) {
      return undefined;
    }

    if (this.sizesBuffer === undefined) {
      try {
        this.sizesBuffer = await this.store.read(this.version, this.sizesResource);
      } catch {
        this.sizesBuffer = new Uint8Array(65536);
      }
    }

    let png = this.pageCache.get(page);
    if (png === undefined) {
      const pageHex = page.toString(16).padStart(2, "0");
      const pageResourceLocation = this.templateResource.replace("%s", pageHex);
      try {
        const pageBytes = await this.store.read(this.version, parseResourceLocation(pageResourceLocation));
        png = PNG.sync.read(Buffer.from(pageBytes));
        this.pageCache.set(page, png);
      } catch {
        this.pageCache.set(page, null);
        png = null;
      }
    }

    if (png === null || png === undefined) {
      return undefined;
    }

    const sizeByte = this.sizesBuffer[codepoint] ?? 0;
    const startCol = sizeByte >> 4;
    const endCol = sizeByte & 0x0f;

    if (sizeByte === 0 && startCol === 0 && endCol === 0) {
      return undefined;
    }

    const tileWidth = Math.floor(png.width / 16);
    const tileHeight = Math.floor(png.height / 16);

    const tileX = (tileIdx % 16) * tileWidth;
    const tileY = Math.floor(tileIdx / 16) * tileHeight;

    const cropLeft = startCol;
    const cropRight = endCol;
    const glyphWidth = Math.max(1, (cropRight - cropLeft) + 1);

    const contours = [];
    const dummyContext = {
      version: this.version,
      store: this.store,
      scale: DEFAULT_COORDINATE_SCALE,
      resolveFontGlyph: async () => undefined,
    };

    let hasVisiblePixels = false;
    for (let y = 0; y < tileHeight; y++) {
      for (let x = 0; x < glyphWidth; x++) {
        const srcX = tileX + cropLeft + x;
        const srcY = tileY + y;
        const srcIdx = (png.width * srcY + srcX) << 2;
        const alpha = png.data[srcIdx + 3] ?? 0;
        if (alpha > 0) {
          hasVisiblePixels = true;
          contours.push(
            createSourcePixelContour(x, y, 1, 1, 11, dummyContext),
          );
        }
      }
    }

    if (!hasVisiblePixels) return undefined;

    return createMinecraftGlyph({
      codepoint,
      contours,
      metrics: {
        advance: (glyphWidth + 1) * 128,
        boldOffset: 128,
        bearingLeft: 0,
        bearingTop: 11 * 128,
      },
    });
  }
}
