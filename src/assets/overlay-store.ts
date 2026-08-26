import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AssetNotFoundError, AssetSourceError } from "./errors";
import {
  parseResourceLocation,
  resourceLocationToAssetPath,
  resolveAssetPathWithinRoot,
  type ResourceLocationInput,
} from "./resource-location";
import type { AssetBytes, AssetSource } from "./asset-source";
import type { AssetStore } from "./asset-store";

/** Reads assets directly from an unzipped Minecraft resource pack directory. */
export class ResourcePackAssetStore implements AssetStore {
  readonly rootDirectory: string;

  constructor(packDirectory: string) {
    this.rootDirectory = resolve(packDirectory);
  }

  hasAsset(resource: ResourceLocationInput): boolean {
    const parsed = parseResourceLocation(resource);
    const relative = resourceLocationToAssetPath(parsed);
    try {
      const fullPath = resolveAssetPathWithinRoot(this.rootDirectory, relative);
      return existsSync(fullPath);
    } catch {
      return false;
    }
  }

  async read(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    const parsed = parseResourceLocation(resource);
    const relative = resourceLocationToAssetPath(parsed);
    let fullPath: string;
    try {
      fullPath = resolveAssetPathWithinRoot(this.rootDirectory, relative);
    } catch (err) {
      throw new AssetNotFoundError(
        version,
        `${parsed.namespace}:${parsed.path}`,
        err,
      );
    }

    if (!existsSync(fullPath)) {
      throw new AssetNotFoundError(
        version,
        `${parsed.namespace}:${parsed.path}`,
      );
    }

    try {
      const bytes = await readFile(fullPath);
      return new Uint8Array(bytes);
    } catch (err) {
      throw new AssetSourceError(
        `Failed to read resource pack asset: ${parsed.namespace}:${parsed.path}`,
        version,
        `${parsed.namespace}:${parsed.path}`,
        err,
      );
    }
  }

  get(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    return this.read(version, resource);
  }
}

/**
 * Overlay Asset Store:
 * Attempts to load resources from the user's Resource Pack first.
 * If missing in the pack, seamlessly falls back to the Vanilla Asset Store.
 */
export class OverlayAssetStore implements AssetStore {
  readonly resourcePackStore: ResourcePackAssetStore;
  readonly vanillaStore: AssetStore;

  constructor(options: { readonly packDirectory: string; readonly vanillaStore: AssetStore }) {
    this.resourcePackStore = new ResourcePackAssetStore(options.packDirectory);
    this.vanillaStore = options.vanillaStore;
  }

  async read(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    if (this.resourcePackStore.hasAsset(resource)) {
      try {
        return await this.resourcePackStore.read(version, resource);
      } catch (err) {
        if (!(err instanceof AssetNotFoundError)) {
          throw err;
        }
      }
    }
    return this.vanillaStore.read(version, resource);
  }

  get(version: string, resource: ResourceLocationInput): Promise<AssetBytes> {
    return this.read(version, resource);
  }
}
