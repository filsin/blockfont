import { BitmapGlyphProvider } from "./bitmap-provider";
import type { MinecraftProviderDefinition } from "./font-definition";
import { LegacyUnicodeProvider } from "./legacy-unicode-provider";
import { ReferenceGlyphProvider } from "./reference-provider";
import { SpaceGlyphProvider } from "./space-provider";
import { TtfGlyphProvider } from "./ttf-provider";
import { UnihexGlyphProvider } from "./unihex-provider";
import type { GlyphProvider, ProviderContext } from "./provider-utils";

/** Instantiates one normalized provider definition. */
export function createGlyphProvider(
  definition: MinecraftProviderDefinition,
  context: ProviderContext,
): GlyphProvider {
  switch (definition.type) {
    case "bitmap":
      return new BitmapGlyphProvider(definition, context);
    case "unihex":
      return new UnihexGlyphProvider(definition, context);
    case "space":
      return new SpaceGlyphProvider(definition, context);
    case "reference":
      return new ReferenceGlyphProvider(definition, context);
    case "ttf":
      return new TtfGlyphProvider(definition, context);
    case "legacy_unicode":
      return new LegacyUnicodeProvider({
        sizesResource: definition.sizes,
        templateResource: definition.template,
        store: context.store,
        version: context.version,
      });
  }
}
