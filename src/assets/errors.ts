/** Stable error codes emitted by the asset boundary. */
export type AssetErrorCode =
  | "asset-not-found"
  | "invalid-asset"
  | "asset-source"
  | "asset-version";

export interface AssetErrorDetails {
  readonly code: AssetErrorCode;
  readonly version?: string;
  readonly resource?: string;
}

/** Base error for failures while locating or reading source assets. */
export class AssetError extends Error {
  readonly details: AssetErrorDetails;

  constructor(message: string, details: AssetErrorDetails, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "AssetError";
    this.details = Object.freeze(details);
  }
}

/** Raised when a requested version/resource is not available. */
export class AssetNotFoundError extends AssetError {
  constructor(version: string, resource: string, cause?: unknown) {
    super(
      `Asset not found for Minecraft ${version}: ${resource}`,
      { code: "asset-not-found", version, resource },
      cause,
    );
    this.name = "AssetNotFoundError";
  }
}

/** Raised when an asset exists but cannot be decoded or validated. */
export class InvalidAssetError extends AssetError {
  constructor(message: string, version?: string, resource?: string, cause?: unknown) {
    const details: { code: "invalid-asset"; version?: string; resource?: string } = {
      code: "invalid-asset",
    };
    if (version !== undefined) details.version = version;
    if (resource !== undefined) details.resource = resource;
    super(message, details, cause);
    this.name = "InvalidAssetError";
  }
}

/** Raised when a source/downloader fails for a reason other than a missing asset. */
export class AssetSourceError extends AssetError {
  constructor(message: string, version?: string, resource?: string, cause?: unknown) {
    const details: { code: "asset-source"; version?: string; resource?: string } = {
      code: "asset-source",
    };
    if (version !== undefined) details.version = version;
    if (resource !== undefined) details.resource = resource;
    super(message, details, cause);
    this.name = "AssetSourceError";
  }
}

/** Raised when a version resolver cannot produce a usable location. */
export class AssetVersionError extends AssetError {
  constructor(message: string, version?: string, cause?: unknown) {
    const details: { code: "asset-version"; version?: string } = {
      code: "asset-version",
    };
    if (version !== undefined) details.version = version;
    super(message, details, cause);
    this.name = "AssetVersionError";
  }
}
