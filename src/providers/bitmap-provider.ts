import { PNG } from "pngjs";

import type { MinecraftGlyph } from "../core";
import { InvalidProviderError } from "./errors";
import type { BitmapProviderDefinition } from "./font-definition";
import {
  assertUnicodeScalar,
  createProviderGlyph,
  createSourcePixelContour,
  lookupProviderNumber,
  type GlyphProvider,
  type ProviderContext,
} from "./provider-utils";
import { readAssetBytes } from "../assets";

interface BitmapSlot {
  readonly row: number;
  readonly column: number;
}

interface BitmapLayout {
  readonly image: PNG;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly logicalScale: number;
  readonly slots: ReadonlyMap<number, BitmapSlot>;
}

/** Resolves Minecraft bitmap providers using pngjs for real PNG decoding. */
export class BitmapGlyphProvider implements GlyphProvider {
  readonly type = "bitmap" as const;
  private readonly definition: BitmapProviderDefinition;
  private readonly context: ProviderContext;
  private layoutPromise?: Promise<BitmapLayout>;

  constructor(definition: BitmapProviderDefinition, context: ProviderContext) {
    this.definition = definition;
    this.context = context;
  }

  private async loadLayout(): Promise<BitmapLayout> {
    const bytes = await readAssetBytes(this.context.store, this.context.version, this.definition.file);
    let image: PNG;
    try {
      image = PNG.sync.read(Buffer.from(bytes));
    } catch (error) {
      throw new InvalidProviderError(
        `Unable to decode bitmap provider PNG: ${this.definition.file}`,
        this.type,
        this.definition.file,
        undefined,
        error,
      );
    }

    const rows = this.definition.chars.length;
    const columns = Math.max(
      ...this.definition.chars.map((row) => Array.from(row).length),
    );
    if (rows <= 0 || columns <= 0) {
      throw new InvalidProviderError(
        "Bitmap provider must define at least one row and column",
        this.type,
        this.definition.file,
      );
    }
    const cellWidth = Math.round(image.width / columns);
    const cellHeight = Math.round(image.height / rows);
    const logicalHeight = this.definition.height ?? 8;
    if (logicalHeight <= 0) {
      throw new InvalidProviderError("Bitmap height must be positive", this.type);
    }
    const logicalScale = logicalHeight / cellHeight;
    const sourcePixelSizeInFontUnits =
      logicalScale * this.context.scale.fontUnitsPerMinecraftPixel;
    if (!Number.isSafeInteger(sourcePixelSizeInFontUnits)) {
      throw new InvalidProviderError(
        `Bitmap logical scale ${logicalScale} does not map source pixels to the configured OpenType grid`,
        this.type,
        this.definition.file,
      );
    }
    const slots = new Map<number, BitmapSlot>();
    for (let row = 0; row < this.definition.chars.length; row += 1) {
      const characters = Array.from(this.definition.chars[row] ?? "");
      for (let column = 0; column < characters.length; column += 1) {
        const character = characters[column];
        if (character === undefined) continue;
        const codepoint = character.codePointAt(0);
        if (codepoint === undefined || codepoint === 0) continue;
        if (slots.has(codepoint)) {
          throw new InvalidProviderError(
            `Bitmap character U+${codepoint.toString(16).toUpperCase()} is duplicated`,
            this.type,
            this.definition.file,
          );
        }
        slots.set(codepoint, { row, column });
      }
    }

    return { image, cellWidth, cellHeight, logicalScale, slots };
  }

  private getLayout(): Promise<BitmapLayout> {
    this.layoutPromise ??= this.loadLayout();
    return this.layoutPromise;
  }

  async resolve(codepoint: number): Promise<MinecraftGlyph | undefined> {
    assertUnicodeScalar(codepoint);
    const layout = await this.getLayout();
    const slot = layout.slots.get(codepoint);
    if (slot === undefined) return undefined;

    const sourceX = slot.column * layout.cellWidth;
    const sourceY = slot.row * layout.cellHeight;
    const contours = [];
    let rightmostActivePixel = -1;
    for (let pixelY = 0; pixelY < layout.cellHeight; pixelY += 1) {
      for (let pixelX = 0; pixelX < layout.cellWidth; pixelX += 1) {
        const imageIndex = ((sourceY + pixelY) * layout.image.width + sourceX + pixelX) * 4;
        const alpha = layout.image.data[imageIndex + 3];
        if (alpha === undefined || alpha === 0) continue;
        rightmostActivePixel = Math.max(rightmostActivePixel, pixelX);
        contours.push(
          createSourcePixelContour(
            pixelX * layout.logicalScale +
              (this.definition.bearingLeft ?? 0),
            pixelY * layout.logicalScale,
            layout.logicalScale,
            layout.logicalScale,
            this.definition.ascent,
            this.context,
          ),
        );
      }
    }

    const actualWidth = rightmostActivePixel < 0
      ? 0
      : (rightmostActivePixel + 1) * layout.logicalScale;
    // Vanilla bitmap cells reserve one source pixel of right-side padding.
    // Scaling that padding with the cell keeps high-resolution providers
    // proportional; an explicit advance still takes precedence below.
    const defaultAdvance = actualWidth === 0
      ? 0
      : (rightmostActivePixel + 2) * layout.logicalScale;
    const advance = lookupProviderNumber(
      this.definition,
      codepoint,
      "advance",
      defaultAdvance,
    );
    const metrics = {
      advance,
      boldOffset: lookupProviderNumber(this.definition, codepoint, "boldOffset", 1),
      bearingLeft: lookupProviderNumber(this.definition, codepoint, "bearingLeft", 0),
      bearingTop: lookupProviderNumber(
        this.definition,
        codepoint,
        "bearingTop",
        this.definition.ascent,
      ),
    };
    return createProviderGlyph(codepoint, contours, metrics, this.context, this.type);
  }

  /** Useful for callers that want to inspect provider coverage without I/O duplication. */
  async has(codepoint: number): Promise<boolean> {
    assertUnicodeScalar(codepoint);
    const layout = await this.getLayout();
    return layout.slots.has(codepoint);
  }

  /** Returns the source character mapping used by this provider. */
  getCharacterSlot(character: string): Promise<BitmapSlot | undefined> {
    const codepoint = character.codePointAt(0);
    return codepoint === undefined
      ? Promise.resolve(undefined)
      : this.getLayout().then((layout) => layout.slots.get(codepoint));
  }

  /** Explicit helper for callers using a string rather than a codepoint. */
  resolveCharacter(character: string): Promise<MinecraftGlyph | undefined> {
    const codepoint = character.codePointAt(0);
    return codepoint === undefined
      ? Promise.resolve(undefined)
      : this.resolve(codepoint);
  }
}
