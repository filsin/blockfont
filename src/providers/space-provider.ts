import type { MinecraftGlyph } from "../core";
import { InvalidProviderError } from "./errors";
import type { SpaceProviderDefinition } from "./font-definition";
import {
  assertUnicodeScalar,
  lookupCodepointMapNumber,
  createProviderGlyph,
  lookupProviderNumber,
  type GlyphProvider,
  type ProviderContext,
} from "./provider-utils";

/** Resolves a provider that contributes advance only and no visible contours. */
export class SpaceGlyphProvider implements GlyphProvider {
  readonly type = "space" as const;
  private readonly definition: SpaceProviderDefinition;
  private readonly context: ProviderContext;

  constructor(definition: SpaceProviderDefinition, context: ProviderContext) {
    this.definition = definition;
    this.context = context;
  }

  async resolve(codepoint: number): Promise<MinecraftGlyph | undefined> {
    assertUnicodeScalar(codepoint);
    const advance = lookupCodepointMapNumber(this.definition.advances, codepoint);
    if (advance === undefined) return undefined;
    if (advance < 0) {
      throw new InvalidProviderError(
        `Space advance cannot be negative: ${advance}`,
        this.type,
        undefined,
        codepoint,
      );
    }
    return createProviderGlyph(
      codepoint,
      [],
      {
        advance,
        boldOffset: lookupProviderNumber(this.definition, codepoint, "boldOffset", 0),
        bearingLeft: lookupProviderNumber(this.definition, codepoint, "bearingLeft", 0),
        bearingTop: lookupProviderNumber(this.definition, codepoint, "bearingTop", 0),
      },
      this.context,
      this.type,
    );
  }
}
