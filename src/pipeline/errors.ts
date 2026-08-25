/** Stable error codes emitted by the public generation pipeline. */
export type BlockFontErrorCode =
  | "invalid-options"
  | "asset-source"
  | "coverage"
  | "generation"
  | "output";

export interface BlockFontErrorDetails {
  readonly code: BlockFontErrorCode;
  readonly version?: string;
  readonly fontId?: string;
  readonly style?: string;
  readonly format?: string;
  readonly path?: string;
}

/** Error raised for invalid public options or a failed pipeline stage. */
export class BlockFontError extends Error {
  readonly details: BlockFontErrorDetails;

  public constructor(
    message: string,
    details: BlockFontErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "BlockFontError";
    this.details = Object.freeze(details);
  }
}

export class InvalidBlockFontOptionsError extends BlockFontError {
  public constructor(message: string, cause?: unknown) {
    super(message, { code: "invalid-options" }, cause);
    this.name = "InvalidBlockFontOptionsError";
  }
}

export class BlockFontCoverageError extends BlockFontError {
  public constructor(message: string, cause?: unknown) {
    super(message, { code: "coverage" }, cause);
    this.name = "BlockFontCoverageError";
  }
}

export class BlockFontGenerationError extends BlockFontError {
  public constructor(
    message: string,
    details: Omit<BlockFontErrorDetails, "code"> = {},
    cause?: unknown,
  ) {
    super(message, { ...details, code: "generation" }, cause);
    this.name = "BlockFontGenerationError";
  }
}

export class BlockFontOutputError extends BlockFontError {
  public constructor(path: string, cause?: unknown) {
    super(`Unable to write generated font: ${path}`, { code: "output", path }, cause);
    this.name = "BlockFontOutputError";
  }
}
