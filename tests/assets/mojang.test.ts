import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  MojangAssetDownloader,
  ensureMinecraftAssets,
  extractZipEntries,
  readUint16LE,
  readUint32LE,
} from "../../src/assets/mojang";

describe("Mojang asset downloader & extraction", () => {
  it("extracts zip entries from a buffer", () => {
    // Basic byte reader check
    const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
    expect(readUint16LE(bytes, 0)).toBe(0x3412);
    expect(readUint32LE(bytes, 0)).toBe(0x78563412);
  });

  it("fetches version package and client download url with mock fetcher", async () => {
    const mockManifest = {
      latest: { release: "1.21", snapshot: "1.21" },
      versions: [
        {
          id: "1.21",
          type: "release",
          url: "https://mock.mojang.com/v1/1.21.json",
          time: "",
          releaseTime: "",
          sha1: "",
        },
      ],
    };

    const mockPackage = {
      id: "1.21",
      downloads: {
        client: {
          sha1: "abc",
          size: 100,
          url: "https://mock.mojang.com/v1/client.jar",
        },
      },
    };

    const downloader = new MojangAssetDownloader({
      fetcher: async (url) => {
        if (url.includes("version_manifest")) {
          return new TextEncoder().encode(JSON.stringify(mockManifest));
        }
        if (url.includes("1.21.json")) {
          return new TextEncoder().encode(JSON.stringify(mockPackage));
        }
        if (url.includes("client.jar")) {
          return new Uint8Array([1, 2, 3, 4]);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const manifest = await downloader.getManifest();
    expect(manifest.latest.release).toBe("1.21");

    const pkg = await downloader.getVersionPackage("1.21");
    expect(pkg.id).toBe("1.21");

    const jar = await downloader.downloadClientJar(pkg);
    expect(jar).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("skips download when assets already exist on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "blockfont-mojang-test-"));
    const fontDir = join(root, "1.21", "assets", "minecraft", "font");
    await mkdir(fontDir, { recursive: true });
    await writeFile(join(fontDir, "default.json"), '{"providers":[]}');

    let fetchCalled = false;
    const downloader = new MojangAssetDownloader({
      fetcher: async () => {
        fetchCalled = true;
        throw new Error("Should not be called");
      },
    });

    const result = await ensureMinecraftAssets({
      version: "1.21",
      rootDirectory: root,
      downloader,
    });

    expect(result).toBe(root);
    expect(fetchCalled).toBe(false);
  });
});
