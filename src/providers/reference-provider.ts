import type { MinecraftGlyph } from "../core";
import type { ReferenceProviderDefinition } from "./font-definition";
import {
  assertUnicodeScalar,
  type GlyphProvider,
  type ProviderContext,
} from "./provider-utils";

/** Delegates resolution to another Minecraft font definition. */
export class ReferenceGlyphProvider implements GlyphProvider {
  readonly type = "reference" as const;
  private readonly definition: ReferenceProviderDefinition;
  private readonly context: ProviderContext;

  constructor(definition: ReferenceProviderDefinition, context: ProviderContext) {
    this.definition = definition;
    this.context = context;
  }

  async resolve(
    codepoint: number,
    stack: readonly string[] = [],
  ): Promise<MinecraftGlyph | undefined> {
    assertUnicodeScalar(codepoint);
    return this.context.resolveFontGlyph(this.definition.id, codepoint, stack);
  }
}
