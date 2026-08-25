import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AssetNotFoundError, AssetSourceError } from "./errors";
import {
  parseResourceLocation,
  resourceLocationKey,
  resourceLocationToAssetPath,
  resolveAssetPathWithinRoot,
  validateAssetVersion,
  type ResourceLocationInput,
} from "./resource-location";
import type { AssetBytes, AssetSource } from "./asset-source";

/** Store contract adds a stable `get` alias to the source read operation. */
export interface AssetStore extends AssetSource {
  get(version: string, resource: ResourceLocationInput): Promise<AssetBytes>;
}

export async function readAssetBytes(
  store: AssetSource,
  version: string,
  resource: ResourceLocationInput,
): Promise<AssetBytes> {
  return store.read(version, resource);
}

export async function readAssetText(
  store: AssetSource,
  version: string,
  resource: ResourceLocationInput,
): Promise<string> {
  const bytes = await readAssetBytes(store, version, resource);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function readAssetJson<T>(
  store: AssetSource,
  version: string,
  resource: ResourceLocationInput,
): Promise<T> {
  const resourceId = parseResourceLocation(resource);
  let text: string;
  try {
    text = await readAssetText(store, version, resourceId);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new AssetSourceError(
        `Asset is not valid UTF-8: ${resourceId.namespace}:${resourceId.path}`,
        version,
        `${resourceId.namespace}:${resourceId.path}`,
        error,
      );
    }
    throw error;
  }
  try {
    try {
      return JSON.parse(text) as T;
    } catch {
      const cleaned = text
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")
        .replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(cleaned) as T;
    }
  } catch (error) {
    throw new AssetSourceError(
      `Asset is not valid JSON: ${resourceId.namespace}:${resourceId.path}`,
      version,
      `${resourceId.namespace}:${resourceId.path}`,
      error,
    );
  }
}

/** Simple in-memory cache around any injectable source. */
export class CachingAssetStore implements AssetStore {
  private readonly source: AssetSource;
  private readonly memory = new Map<string, AssetBytes>();
  private readonly cacheDirectory: string | undefined;

  constructor(options: { readonly source: AssetSource; readonly cacheDirectory?: string }) {
    this.source = options.source;
    if (options.cacheDirectory !== undefined && options.cacheDirectory.trim().length === 0) {
      throw new AssetSourceError("Asset cache directory must not be empty");
    }
    this.cacheDirectory = options.cacheDirectory === undefined
      ? undefined
      : resolve(options.cacheDirectory);
  }

  private cachePath(version: string, resource: ResourceLocationInput): string {
    validateAssetVersion(version);
    const parsed = parseResourceLocation(resource);
    return resolveAssetPathWithinRoot(
      this.cacheDirectory as string,
      `${version}/${resourceLocationToAssetPath(parsed)}`,
    );
  }

  async read(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    const key = resourceLocationKey(version, resource);
    const fromMemory = this.memory.get(key);
    if (fromMemory !== undefined) {
      return new Uint8Array(fromMemory);
    }

    if (this.cacheDirectory !== undefined) {
      try {
        const cached = await readFile(this.cachePath(version, resource));
        const bytes = new Uint8Array(cached);
        this.memory.set(key, bytes);
        return new Uint8Array(bytes);
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw new AssetSourceError(
            `Unable to read cached asset for ${version}`,
            version,
            `${parseResourceLocation(resource).namespace}:${parseResourceLocation(resource).path}`,
            error,
          );
        }
      }
    }

    const bytes = await this.source.read(version, resource);
    const copy = new Uint8Array(bytes);
    this.memory.set(key, copy);

    if (this.cacheDirectory !== undefined) {
      const path = this.cachePath(version, resource);
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, copy, { flag: "wx" }).catch(async (error: unknown) => {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            return;
          }
          throw error;
        });
      } catch (error) {
        throw new AssetSourceError(
          `Unable to write cached asset for ${version}`,
          version,
          `${parseResourceLocation(resource).namespace}:${parseResourceLocation(resource).path}`,
          error,
        );
      }
    }

    return new Uint8Array(copy);
  }

  get(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    return this.read(version, resource);
  }
}

/** Store alias for callers that prefer an explicit memory-only name. */
export class MemoryAssetStore extends CachingAssetStore {
  constructor(source: AssetSource) {
    super({ source });
  }
}

/** Converts a missing cache entry into the same source-level contract. */
export function isAssetNotFound(error: unknown): error is AssetNotFoundError {
  return error instanceof AssetNotFoundError;
}
