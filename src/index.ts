export {
  createFont,
  normalizeCharacterSets,
  type FontConfig,
  type CharacterSet,
  type CharacterSetOption,
  type FontStyleOption,
} from "./api/create-font";
export {
  generateBlockFont,
  generateBlockFontFiles,
  createBlockFontGenerator,
} from "./pipeline";

export {
  collectMinecraftGlyphs,
  discoverMinecraftCodepoints,
} from "./pipeline";
export type {
  BlockFontGenerationOptions,
  BlockFontGenerationResult,
  BlockFontOutputFile,
  BlockFontDependencies,
  BlockFontFileSystem,
  BlockFontGenerator,
  BlockFontGlyphResolver,
  GlyphCollectionResult,
  MissingGlyphPolicy,
} from "./pipeline";
export {
  BlockFontError,
  BlockFontCoverageError,
  BlockFontGenerationError,
  BlockFontOutputError,
  InvalidBlockFontOptionsError,
} from "./pipeline";
export type {
  AssetBytes,
  AssetSource,
  AssetStore,
  AssetVersionResolver,
  AssetVersionResolution,
  ResourceLocation,
  ResourceLocationInput,
} from "./assets";
export {
  CachingAssetStore,
  DownloadAssetSource,
  LocalAssetSource,
  MemoryAssetSource,
} from "./assets";
export * from "./assets";
// Re-export the normalized model and the provider/export contracts used by
// callers that inject a resolver or build a custom validation harness.
export * from "./core";
export * from "./geometry";
export * from "./providers";
export * from "./styles";
export * from "./export";

export {
  BlockFontValidationError,
  assertReproducible,
  assertValidFontFile,
  assertValidGeneratedFonts,
  validateBlockFontGeneration,
  validateFontFile,
  validateFontFilePath,
  validateGeneratedFont,
  validateGeneratedFonts,
  validateReproducibility,
} from "./validation";
export type {
  FontBinary,
  FontValidationOptions,
  UnderlineExpectation,
  VerticalMetricsExpectation,
  ValidationIssue,
  ValidationIssueCode,
  ParsedFontSummary,
  FontValidationReport,
  GeneratedFontsValidationOptions,
  GeneratedFontsValidationReport,
  ReproducibilityReport,
  GeneratedFontSetLike,
  GeneratedFontValidationInput,
} from "./validation";
