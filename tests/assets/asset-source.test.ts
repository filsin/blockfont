import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  AssetNotFoundError,
  AssetVersionError,
  CachingAssetStore,
  DownloadAssetSource,
  LocalAssetSource,
  MemoryAssetSource,
  readAssetJson,
  normalizeFontId,
  parseResourceLocation,
  resolveAssetPathWithinRoot,
} from "../../src/assets";

describe("asset sources and stores", () => {
  it("reads a versioned local assets tree without bundling its contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "blockfont-assets-"));
    const resourceDirectory = join(root, "1.21.4", "assets", "minecraft", "font");
    await mkdir(resourceDirectory, { recursive: true });
    await writeFile(join(resourceDirectory, "default.json"), '{"providers":[]}');

    const source = new LocalAssetSource({ rootDirectory: root });
    const value = await readAssetJson<{ providers: unknown[] }>(
      source,
      "1.21.4",
      "minecraft:font/default.json",
    );
    expect(value).toEqual({ providers: [] });
    await expect(source.read("1.20.1", "minecraft:font/default.json"))
      .rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it("accepts a directory that already points at assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "blockfont-assets-direct-"));
    const fontDirectory = join(root, "minecraft", "font");
    await mkdir(fontDirectory, { recursive: true });
    await writeFile(join(fontDirectory, "default.json"), '{"providers":[]}');

    const source = new LocalAssetSource({ rootDirectory: join(root, "assets") });
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, "assets", "minecraft", "font"), { recursive: true });
    await writeFile(join(root, "assets", "minecraft", "font", "default.json"), '{"providers":[]}');
    await expect(source.read("test", "minecraft:font/default.json")).resolves.toBeInstanceOf(Uint8Array);
  });

  it("uses injected deterministic download URLs and memoizes through a store", async () => {
    const source = new MemoryAssetSource();
    let downloads = 0;
    const remote = new DownloadAssetSource({
      urlFor: (version, resource) => `fixture://${version}/${resource.namespace}/${resource.path}`,
      downloader: {
        download: async (url) => {
          downloads += 1;
          return new TextEncoder().encode(url);
        },
      },
    });
    const cache = new CachingAssetStore({ source: remote });
    const first = await cache.read("test", "minecraft:font/default.json");
    const second = await cache.read("test", "minecraft:font/default.json");
    expect(new TextDecoder().decode(first)).toBe(
      "fixture://test/minecraft/font/default.json",
    );
    expect(second).toEqual(first);
    expect(downloads).toBe(1);
    expect(source).toBeInstanceOf(MemoryAssetSource);
  });

  it("supports explicit version root resolution", async () => {
    const versionRoot = await mkdtemp(join(tmpdir(), "blockfont-version-root-"));
    await mkdir(join(versionRoot, "assets", "minecraft", "font"), { recursive: true });
    await writeFile(join(versionRoot, "assets", "minecraft", "font", "default.json"), '{"providers":[]}');
    const source = new LocalAssetSource({
      rootDirectory: "/unused",
      layout: "versioned",
      versionResolver: (version) => {
        expect(version).toBe("fixture-version");
        return versionRoot;
      },
    });
    await expect(source.read("fixture-version", "minecraft:font/default.json"))
      .resolves.toBeInstanceOf(Uint8Array);
  });

  it("rejects traversal and reports missing resources explicitly", async () => {
    const source = new MemoryAssetSource();
    expect(() => source.set("test", "minecraft:../secret", "bad")).toThrow();
    await expect(source.read("test", "minecraft:font/missing.json"))
      .rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it("rejects traversal in versions, font ids, resource ids, and cache paths", async () => {
    const source = new MemoryAssetSource();
    const unsafeVersions = ["../escape", "..\\escape", "/tmp/assets", "C:\\tmp\\assets"];
    for (const version of unsafeVersions) {
      await expect(source.read(version, "minecraft:font/default.json"))
        .rejects.toBeInstanceOf(AssetVersionError);
      expect(() => source.set(version, "minecraft:font/default.json", "bad"))
        .toThrow(AssetVersionError);
    }

    expect(() => parseResourceLocation("minecraft:font/../secret.json")).toThrow();
    expect(() => parseResourceLocation("minecraft:/absolute.json")).toThrow();
    expect(() => parseResourceLocation({ namespace: "..", path: "font/default.json" })).toThrow();
    expect(() => normalizeFontId("minecraft:font\\..\\secret")).toThrow();

    const cacheRoot = await mkdtemp(join(tmpdir(), "blockfont-cache-traversal-"));
    const cache = new CachingAssetStore({ source, cacheDirectory: cacheRoot });
    await expect(cache.read("1.21/../escape", "minecraft:font/default.json"))
      .rejects.toBeInstanceOf(AssetVersionError);
    expect(() => resolveAssetPathWithinRoot(cacheRoot, "../outside.json")).toThrow();
    expect(() => resolveAssetPathWithinRoot(cacheRoot, "nested/../outside.json")).toThrow();
    expect(() => resolveAssetPathWithinRoot(cacheRoot, "..\\outside.json")).toThrow();
    expect(() => resolveAssetPathWithinRoot(cacheRoot, "C:\\outside.json")).toThrow();
  });
});
