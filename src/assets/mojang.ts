import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

import { AssetNotFoundError, AssetSourceError, AssetVersionError } from "./errors";
import { parseResourceLocation, validateAssetVersion } from "./resource-location";

export const MOJANG_VERSION_MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
export const MOJANG_RESOURCES_BASE_URL =
  "https://resources.download.minecraft.net";

export interface MojangVersionManifestEntry {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly time: string;
  readonly releaseTime: string;
  readonly sha1: string;
}

export interface MojangVersionManifest {
  readonly latest: {
    readonly release: string;
    readonly snapshot: string;
  };
  readonly versions: readonly MojangVersionManifestEntry[];
}

export interface MojangVersionPackage {
  readonly id: string;
  readonly assetIndex?: {
    readonly id: string;
    readonly sha1: string;
    readonly size: number;
    readonly url: string;
  };
  readonly downloads?: {
    readonly client?: {
      readonly sha1: string;
      readonly size: number;
      readonly url: string;
    };
  };
}

export interface MojangAssetIndex {
  readonly objects: Readonly<Record<string, { readonly hash: string; readonly size: number }>>;
}

export interface MojangAssetDownloaderOptions {
  readonly manifestUrl?: string;
  readonly fetcher?: (url: string) => Promise<Uint8Array>;
}

async function defaultFetcher(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status} ${response.statusText} for ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

export interface ExtractedAssetFile {
  readonly path: string;
  readonly data: Uint8Array;
}

/** Extracts files from a ZIP archive buffer (such as client.jar). */
export function extractZipEntries(
  buffer: Uint8Array,
  filter?: (name: string) => boolean,
): Map<string, Uint8Array> {
  const endOfCentralDirectorySignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  const localFileSignature = 0x04034b50;

  let endOfCentralDirectory = -1;
  const minimumEndOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (readUint32LE(buffer, offset) === endOfCentralDirectorySignature) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  if (endOfCentralDirectory < 0) {
    throw new Error("Invalid ZIP archive: End of central directory record not found");
  }

  const centralDirectoryOffset = readUint32LE(buffer, endOfCentralDirectory + 16);
  const entryCount = readUint16LE(buffer, endOfCentralDirectory + 10);
  const result = new Map<string, Uint8Array>();

  let centralOffset = centralDirectoryOffset;
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32LE(buffer, centralOffset) !== centralDirectorySignature) break;

    const compression = readUint16LE(buffer, centralOffset + 10);
    const compressedSize = readUint32LE(buffer, centralOffset + 20);
    const nameLength = readUint16LE(buffer, centralOffset + 28);
    const extraLength = readUint16LE(buffer, centralOffset + 30);
    const commentLength = readUint16LE(buffer, centralOffset + 32);
    const localHeaderOffset = readUint32LE(buffer, centralOffset + 42);

    const nameBytes = buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength);
    const name = decoder.decode(nameBytes);

    centralOffset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (filter !== undefined && !filter(name)) continue;

    if (readUint32LE(buffer, localHeaderOffset) !== localFileSignature) {
      throw new Error(`Invalid local file header in ZIP for entry: ${name}`);
    }

    const localNameLength = readUint16LE(buffer, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    const decompressed = compression === 8
      ? new Uint8Array(inflateRawSync(compressedData))
      : new Uint8Array(compressedData);

    result.set(name, decompressed);
  }

  return result;
}

export class MojangAssetDownloader {
  readonly manifestUrl: string;
  private readonly fetcher: (url: string) => Promise<Uint8Array>;
  private manifestPromise?: Promise<MojangVersionManifest>;

  constructor(options: MojangAssetDownloaderOptions = {}) {
    this.manifestUrl = options.manifestUrl ?? MOJANG_VERSION_MANIFEST_URL;
    this.fetcher = options.fetcher ?? defaultFetcher;
  }

  async getManifest(): Promise<MojangVersionManifest> {
    this.manifestPromise ??= (async () => {
      const bytes = await this.fetcher(this.manifestUrl);
      const text = new TextDecoder("utf-8").decode(bytes);
      return JSON.parse(text) as MojangVersionManifest;
    })();
    return this.manifestPromise;
  }

  async getVersionPackage(version: string): Promise<MojangVersionPackage> {
    validateAssetVersion(version);
    const manifest = await this.getManifest();
    const entry = manifest.versions.find((item) => item.id === version);
    if (entry === undefined) {
      throw new AssetVersionError(`Minecraft version ${version} not found in Mojang version manifest`, version);
    }
    const bytes = await this.fetcher(entry.url);
    const text = new TextDecoder("utf-8").decode(bytes);
    return JSON.parse(text) as MojangVersionPackage;
  }

  async downloadClientJar(pkg: MojangVersionPackage): Promise<Uint8Array> {
    const clientUrl = pkg.downloads?.client?.url;
    if (clientUrl === undefined || clientUrl.length === 0) {
      throw new AssetSourceError(
        `Version package for ${pkg.id} does not specify a client download URL`,
        pkg.id,
      );
    }
    return this.fetcher(clientUrl);
  }

  async getAssetIndex(pkg: MojangVersionPackage): Promise<MojangAssetIndex | undefined> {
    const indexUrl = pkg.assetIndex?.url;
    if (indexUrl === undefined || indexUrl.length === 0) return undefined;
    const bytes = await this.fetcher(indexUrl);
    const text = new TextDecoder("utf-8").decode(bytes);
    return JSON.parse(text) as MojangAssetIndex;
  }

  async downloadAssetObject(hash: string): Promise<Uint8Array> {
    const prefix = hash.slice(0, 2);
    const url = `${MOJANG_RESOURCES_BASE_URL}/${prefix}/${hash}`;
    return this.fetcher(url);
  }
}

export interface EnsureMinecraftAssetsOptions {
  readonly version: string;
  readonly rootDirectory: string;
  readonly downloader?: MojangAssetDownloader;
  readonly force?: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads official Minecraft assets from Mojang if not already present on disk.
 * Extracts `assets/` from `client.jar` and places them in `rootDirectory/<version>/assets/`
 * (or `rootDirectory/assets/` if root matches the layout).
 */
export async function ensureMinecraftAssets(
  options: EnsureMinecraftAssetsOptions,
): Promise<string> {
  const version = validateAssetVersion(options.version);
  const root = resolve(options.rootDirectory);
  const downloader = options.downloader ?? new MojangAssetDownloader();

  // Check if default.json font definition exists locally already.
  const versionedPath = join(root, version, "assets", "minecraft", "font", "default.json");
  const directPath = join(root, "assets", "minecraft", "font", "default.json");

  if (!options.force) {
    if (await fileExists(versionedPath) || await fileExists(directPath)) {
      return root;
    }
  }

  const pkg = await downloader.getVersionPackage(version);
  const jarBuffer = await downloader.downloadClientJar(pkg);
  const jarAssets = extractZipEntries(jarBuffer, (name) => name.startsWith("assets/"));

  // Target directory for extracted assets: root/version
  const targetBase = join(root, version);

  for (const [name, data] of jarAssets.entries()) {
    const filePath = join(targetBase, name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  // Also check asset index for font resources like unifont.zip if present
  try {
    const index = await downloader.getAssetIndex(pkg);
    if (index !== undefined && index.objects !== undefined) {
      for (const [key, obj] of Object.entries(index.objects)) {
        if (key.includes("font") || key.includes("default")) {
          const relativeAssetPath = join("assets", key);
          const targetFilePath = join(targetBase, relativeAssetPath);
          const data = await downloader.downloadAssetObject(obj.hash);
          await mkdir(dirname(targetFilePath), { recursive: true });
          await writeFile(targetFilePath, data);
        }
      }
    }
  } catch {
    // Non-fatal if index objects fetch fails, as client.jar contains main font assets.
  }

  return root;
}
