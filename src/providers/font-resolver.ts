import {
  createCoordinateScale,
  DEFAULT_COORDINATE_SCALE,
  type CoordinateScale,
  type MinecraftGlyph,
} from "../core";
import type { AssetStore } from "../assets";
import { normalizeFontId, validateAssetVersion } from "../assets/resource-location";
import {
  FontResolutionError,
  ReferenceCycleError,
} from "./errors";
import {
  loadFontDefinition,
  type MinecraftFontDefinition,
} from "./font-definition";
import { createGlyphProvider } from "./provider-factory";
import type { GlyphProvider, ProviderContext } from "./provider-utils";

export interface MinecraftFontResolverOptions {
  readonly store?: AssetStore;
  readonly assetStore?: AssetStore;
  readonly version?: string;
  readonly minecraftVersion?: string;
  readonly scale?: CoordinateScale;
  readonly defaultFontId?: string;
}

function assertVersion(version: string | undefined): string {
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new FontResolutionError(
      "A Minecraft version is required to resolve font assets",
    );
  }
  try {
    return validateAssetVersion(version);
  } catch (error) {
    throw new FontResolutionError(
      `Invalid Minecraft version identifier: ${version}`,
      undefined,
      error,
    );
  }
}

function assertCodepoint(codepoint: number): void {
  if (
    !Number.isInteger(codepoint) ||
    codepoint < 0 ||
    codepoint > 0x10ffff ||
    (codepoint >= 0xd800 && codepoint <= 0xdfff)
  ) {
    throw new RangeError(`Font codepoint must be a Unicode scalar value: ${codepoint}`);
  }
}

/**
 * Loads Minecraft font JSON definitions and resolves providers in their
 * declared order. The first provider returning a glyph wins, matching the
 * provider-priority behavior expected by the vanilla font set.
 */
export class MinecraftFontResolver {
  readonly store: AssetStore;
  readonly scale: Readonly<CoordinateScale>;
  readonly defaultFontId: string;
  readonly minecraftVersion: string | undefined;

  private readonly definitions = new Map<string, Promise<MinecraftFontDefinition>>();
  private readonly providers = new Map<string, Promise<readonly GlyphProvider[]>>();

  constructor(options: MinecraftFontResolverOptions) {
    const store = options.store ?? options.assetStore;
    if (store === undefined) {
      throw new FontResolutionError("MinecraftFontResolver requires an AssetStore");
    }
    this.store = store;
    this.scale = options.scale === undefined
      ? DEFAULT_COORDINATE_SCALE
      : createCoordinateScale(
        options.scale.fontUnitsPerMinecraftPixel,
        options.scale.unitsPerEm,
      );
    this.defaultFontId = normalizeFontId(options.defaultFontId ?? "minecraft:default");
    this.minecraftVersion = options.version ?? options.minecraftVersion;
  }

  private getVersion(version?: string): string {
    return assertVersion(version ?? this.minecraftVersion);
  }

  private async loadDefinition(version: string, fontId: string): Promise<MinecraftFontDefinition> {
    const normalizedFontId = normalizeFontId(fontId);
    const key = `${version}\0${normalizedFontId}`;
    let promise = this.definitions.get(key);
    if (promise === undefined) {
      promise = loadFontDefinition(this.store, version, normalizedFontId).catch((err) => {
        // Fallback for Legacy 1.8-1.12.2 fonts where font/*.json does not exist
        return {
          providers: [
            {
              type: "bitmap",
              file: "minecraft:textures/font/ascii.png",
              ascent: 7,
              height: 8,
              chars: [
                "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000",
                "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000",
                " !\"#$%&'()*+,-./",
                "0123456789:;<=>?",
                "@ABCDEFGHIJKLMNO",
                "PQRSTUVWXYZ[\\]^_",
                "`abcdefghijklmno",
                "pqrstuvwxyz{|}~\u0000",
              ],
            },
            {
              type: "legacy_unicode",
              sizes: "minecraft:font/glyph_sizes.bin",
              template: "minecraft:textures/font/unicode_page_%s.png",
            },
          ],
        };
      });
      this.definitions.set(key, promise);
    }
    return promise;
  }

  private async loadProviders(
    version: string,
    normalizedFontId: string,
  ): Promise<readonly GlyphProvider[]> {
    const key = `${version}\0${normalizedFontId}`;
    let promise = this.providers.get(key);
    if (promise === undefined) {
      promise = this.loadDefinition(version, normalizedFontId).then((definition) => {
        const context: ProviderContext = {
          version,
          store: this.store,
          scale: this.scale,
          resolveFontGlyph: (targetFontId, targetCodepoint, stack = []) =>
            this.resolveFrame(version, targetFontId, targetCodepoint, stack),
        };
        return Object.freeze(
          definition.providers.map((provider) => createGlyphProvider(provider, context)),
        );
      });
      this.providers.set(key, promise);
    }
    return promise;
  }

  /** Parses a font definition without resolving any glyph. */
  async loadFont(
    fontId = this.defaultFontId,
    version?: string,
  ): Promise<MinecraftFontDefinition> {
    return this.loadDefinition(this.getVersion(version), fontId);
  }

  private async resolveFrame(
    version: string,
    fontId: string,
    codepoint: number,
    stack: readonly string[],
  ): Promise<MinecraftGlyph | undefined> {
    const normalizedFontId = normalizeFontId(fontId);
    if (stack.includes(normalizedFontId)) {
      throw new ReferenceCycleError([
        ...stack,
        normalizedFontId,
      ]);
    }

    const providers = await this.loadProviders(version, normalizedFontId);
    const nextStack = [...stack, normalizedFontId];
    for (const provider of providers) {
      const glyph = await provider.resolve(codepoint, nextStack);
      if (glyph !== undefined) return glyph;
    }
    return undefined;
  }

  async resolveGlyph(
    codepoint: number,
    fontId = this.defaultFontId,
    version?: string,
  ): Promise<MinecraftGlyph | undefined> {
    assertCodepoint(codepoint);
    return this.resolveFrame(this.getVersion(version), fontId, codepoint, []);
  }

  async getGlyph(
    codepoint: number,
    fontId = this.defaultFontId,
    version?: string,
  ): Promise<MinecraftGlyph | undefined> {
    return this.resolveGlyph(codepoint, fontId, version);
  }

  async resolveCharacter(
    character: string,
    fontId = this.defaultFontId,
    version?: string,
  ): Promise<MinecraftGlyph | undefined> {
    const codepoints = Array.from(character);
    if (codepoints.length !== 1) {
      throw new RangeError("resolveCharacter expects exactly one Unicode scalar");
    }
    return this.resolveGlyph(codepoints[0]?.codePointAt(0) as number, fontId, version);
  }

  async resolveGlyphs(
    codepoints: Iterable<number> | string,
    fontId = this.defaultFontId,
    version?: string,
  ): Promise<ReadonlyMap<number, MinecraftGlyph>> {
    const values = typeof codepoints === "string"
      ? Array.from(codepoints, (character) => character.codePointAt(0) as number)
      : [...codepoints];
    const result = new Map<number, MinecraftGlyph>();
    for (const codepoint of values) {
      const glyph = await this.resolveGlyph(codepoint, fontId, version);
      if (glyph !== undefined) result.set(codepoint, glyph);
    }
    return result;
  }
}

export function createMinecraftFontResolver(
  options: MinecraftFontResolverOptions,
): MinecraftFontResolver {
  return new MinecraftFontResolver(options);
}

export interface ResolveMinecraftGlyphOptions extends MinecraftFontResolverOptions {
  readonly minecraftVersion: string;
  readonly codepoint: number;
  readonly fontId?: string;
}

/** One-shot convenience function for a generator or a small integration. */
export async function resolveMinecraftGlyph(
  options: ResolveMinecraftGlyphOptions,
): Promise<MinecraftGlyph | undefined> {
  const resolver = new MinecraftFontResolver(options);
  return resolver.resolveGlyph(options.codepoint, options.fontId, options.minecraftVersion);
}

export const MinecraftProviderResolver = MinecraftFontResolver;
