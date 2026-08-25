export type ProviderErrorCode =
  | "invalid-provider"
  | "unsupported-provider"
  | "font-resolution"
  | "reference-cycle";

export interface ProviderErrorDetails {
  readonly code: ProviderErrorCode;
  readonly providerType?: string;
  readonly fontId?: string;
  readonly resource?: string;
  readonly codepoint?: number;
}

/** Base error for malformed provider definitions or provider data. */
export class ProviderError extends Error {
  readonly details: ProviderErrorDetails;

  constructor(message: string, details: ProviderErrorDetails, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ProviderError";
    this.details = Object.freeze(details);
  }
}

export class InvalidProviderError extends ProviderError {
  constructor(
    message: string,
    providerType?: string,
    resource?: string,
    codepoint?: number,
    cause?: unknown,
  ) {
    const details: {
      code: "invalid-provider";
      providerType?: string;
      resource?: string;
      codepoint?: number;
    } = { code: "invalid-provider" };
    if (providerType !== undefined) details.providerType = providerType;
    if (resource !== undefined) details.resource = resource;
    if (codepoint !== undefined) details.codepoint = codepoint;
    super(message, details, cause);
    this.name = "InvalidProviderError";
  }
}

export class UnsupportedProviderError extends ProviderError {
  constructor(message: string, providerType?: string, cause?: unknown) {
    const details: { code: "unsupported-provider"; providerType?: string } = {
      code: "unsupported-provider",
    };
    if (providerType !== undefined) details.providerType = providerType;
    super(message, details, cause);
    this.name = "UnsupportedProviderError";
  }
}

export class FontResolutionError extends ProviderError {
  constructor(message: string, fontId?: string, cause?: unknown) {
    const details: { code: "font-resolution"; fontId?: string } = {
      code: "font-resolution",
    };
    if (fontId !== undefined) details.fontId = fontId;
    super(message, details, cause);
    this.name = "FontResolutionError";
  }
}

export class ReferenceCycleError extends ProviderError {
  constructor(fontIds: readonly string[]) {
    const lastFontId = fontIds.at(-1);
    const details: { code: "reference-cycle"; fontId?: string } = {
      code: "reference-cycle",
    };
    if (lastFontId !== undefined) details.fontId = lastFontId;
    super(`Cyclic font reference detected: ${fontIds.join(" -> ")}`, details);
    this.name = "ReferenceCycleError";
  }
}
