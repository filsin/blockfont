import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AssetNotFoundError,
  AssetSourceError,
  AssetVersionError,
} from "./errors";
import {
  parseResourceLocation,
  resourceLocationKey,
  resourceLocationToAssetPath,
  resolveAssetPathWithinRoot,
  validateAssetVersion,
  type ResourceLocationInput,
} from "./resource-location";

export type AssetBytes = Uint8Array;

/** Lowest-level source contract. It performs no parsing and owns no Mojang data. */
export interface AssetSource {
  read(version: string, resource: ResourceLocationInput): Promise<AssetBytes>;
}

export type AssetVersionResolution = string | {
  readonly rootDirectory: string;
};

export interface AssetVersionResolver {
  resolve(version: string): AssetVersionResolution | Promise<AssetVersionResolution>;
}

export type AssetVersionResolverFunction = (
  version: string,
) => AssetVersionResolution | Promise<AssetVersionResolution>;

function assertVersion(version: string): void {
  try {
    validateAssetVersion(version);
  } catch (error) {
    if (error instanceof AssetVersionError) throw error;
    throw new AssetVersionError("Invalid Minecraft version identifier", version, error);
  }
}

function resolveVersionRoot(
  resolution: AssetVersionResolution,
  version: string,
): string {
  const root = typeof resolution === "string" ? resolution : resolution.rootDirectory;
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new AssetVersionError(
      "Version resolver returned an empty asset root",
      version,
    );
  }
  return resolve(root);
}

function asResolver(
  resolver: AssetVersionResolver | AssetVersionResolverFunction,
): AssetVersionResolverFunction {
  return typeof resolver === "function"
    ? resolver
    : (version) => resolver.resolve(version);
}

export interface LocalAssetSourceOptions {
  readonly rootDirectory: string;
  /** Optional resolver for version-specific roots. */
  readonly versionResolver?: AssetVersionResolver | AssetVersionResolverFunction;
  /** auto tries both versioned and unversioned layouts; root/versioned restricts it. */
  readonly layout?: "auto" | "root" | "versioned";
}

/** Reads unpacked assets without putting those assets in the repository. */
export class LocalAssetSource implements AssetSource {
  readonly rootDirectory: string;
  private readonly versionResolver: AssetVersionResolverFunction | undefined;
  private readonly layout: "auto" | "root" | "versioned";

  constructor(options: LocalAssetSourceOptions | string) {
    const normalized = typeof options === "string"
      ? { rootDirectory: options }
      : options;
    if (normalized.rootDirectory.trim().length === 0) {
      throw new AssetVersionError("Local asset root must not be empty");
    }
    this.rootDirectory = resolve(normalized.rootDirectory);
    this.versionResolver = normalized.versionResolver === undefined
      ? undefined
      : asResolver(normalized.versionResolver);
    this.layout = normalized.layout ?? "auto";
  }

  private async getRoots(version: string): Promise<readonly string[]> {
    assertVersion(version);
    const roots: string[] = [];
    if (this.versionResolver !== undefined) {
      try {
        roots.push(resolveVersionRoot(await this.versionResolver(version), version));
      } catch (error) {
        if (error instanceof AssetVersionError) throw error;
        throw new AssetVersionError(
          `Unable to resolve local asset root for ${version}`,
          version,
          error,
        );
      }
    } else if (this.layout !== "root") {
      roots.push(resolveAssetPathWithinRoot(this.rootDirectory, version));
    }

    if (this.layout !== "versioned") {
      roots.push(this.rootDirectory);
    }

    return [...new Set(roots)];
  }

  async read(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    assertVersion(version);
    const parsed = parseResourceLocation(resource);
    const relativePath = resourceLocationToAssetPath(parsed);
    const relativePathWithoutAssets = relativePath.slice("assets/".length);
    const relativePaths = [relativePath, relativePathWithoutAssets];
    if (parsed.path.startsWith("font/")) {
      const textureParsed = { namespace: parsed.namespace, path: `textures/${parsed.path}` };
      const textureRelPath = resourceLocationToAssetPath(textureParsed);
      relativePaths.push(textureRelPath, textureRelPath.slice("assets/".length));
    }

    const roots = await this.getRoots(version);
    const candidates = roots.flatMap((root) =>
      relativePaths.map((rel) => resolveAssetPathWithinRoot(root, rel)),
    );

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const bytes = await readFile(candidate);
        return new Uint8Array(bytes);
      } catch (error) {
        lastError = error;
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw new AssetSourceError(
            `Unable to read asset file: ${candidate}`,
            version,
            `${parsed.namespace}:${parsed.path}`,
            error,
          );
        }
      }
    }

    throw new AssetNotFoundError(
      version,
      `${parsed.namespace}:${parsed.path}`,
      lastError,
    );
  }

  get(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    return this.read(version, resource);
  }
}

/** Alias emphasizing that the source reads a directory tree. */
export const LocalDirectoryAssetSource = LocalAssetSource;

export interface MemoryAssetEntry {
  readonly version: string;
  readonly resource: ResourceLocationInput;
  readonly data: AssetBytes | string;
}

/** In-memory source used by deterministic tests and caller-supplied pipelines. */
export class MemoryAssetSource implements AssetSource {
  private readonly entries = new Map<string, AssetBytes>();

  constructor(entries: readonly MemoryAssetEntry[] = []) {
    for (const entry of entries) {
      this.set(entry.version, entry.resource, entry.data);
    }
  }

  set(version: string, resource: ResourceLocationInput, data: AssetBytes | string): this {
    const bytes = typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
    this.entries.set(resourceLocationKey(version, resource), bytes);
    return this;
  }

  async read(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    const key = resourceLocationKey(version, resource);
    const data = this.entries.get(key);
    if (data === undefined) {
      const parsed = parseResourceLocation(resource);
      throw new AssetNotFoundError(version, `${parsed.namespace}:${parsed.path}`);
    }
    return new Uint8Array(data);
  }

  get(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    return this.read(version, resource);
  }
}

export interface AssetDownloader {
  download(url: string): Promise<AssetBytes>;
}

export interface DownloadAssetSourceOptions {
  readonly urlFor: (
    version: string,
    resource: ReturnType<typeof parseResourceLocation>,
  ) => string | Promise<string>;
  readonly downloader: AssetDownloader;
}

/**
 * Remote source with no hard-coded endpoint. URL construction and network I/O
 * are injected so callers can use a pinned mirror, a fixture server, or an
 * offline deterministic downloader.
 */
export class DownloadAssetSource implements AssetSource {
  private readonly urlFor: DownloadAssetSourceOptions["urlFor"];
  private readonly downloader: AssetDownloader;

  constructor(options: DownloadAssetSourceOptions) {
    this.urlFor = options.urlFor;
    this.downloader = options.downloader;
  }

  async read(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    assertVersion(version);
    const parsed = parseResourceLocation(resource);
    let url: string;
    try {
      url = await this.urlFor(version, parsed);
    } catch (error) {
      throw new AssetSourceError(
        `Unable to resolve download URL for ${version}:${parsed.namespace}:${parsed.path}`,
        version,
        `${parsed.namespace}:${parsed.path}`,
        error,
      );
    }
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new AssetSourceError(
        `URL resolver returned an empty URL for ${version}:${parsed.namespace}:${parsed.path}`,
        version,
        `${parsed.namespace}:${parsed.path}`,
      );
    }

    try {
      const data = await this.downloader.download(url);
      return new Uint8Array(data);
    } catch (error) {
      throw new AssetSourceError(
        `Unable to download asset from ${url}`,
        version,
        `${parsed.namespace}:${parsed.path}`,
        error,
      );
    }
  }

  get(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    return this.read(version, resource);
  }
}
