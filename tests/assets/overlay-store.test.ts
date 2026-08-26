import { describe, expect, it } from "vitest";
import { OverlayAssetStore, ResourcePackAssetStore } from "../../src/assets/overlay-store";
import { MemoryAssetStore } from "../../src/assets/asset-store";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Overlay Asset Store", () => {
  it("resolves asset from resource pack when present, falls back to vanilla when missing", async () => {
    const packDir = join(tmpdir(), `test_overlay_pack_${Date.now()}`);
    await mkdir(join(packDir, "assets/minecraft/textures/font"), { recursive: true });
    await writeFile(join(packDir, "assets/minecraft/textures/font/ascii.png"), new Uint8Array([1, 2, 3]));

    const vanillaSource = {
      read: async (_v: string, r: any) => {
        return new Uint8Array([4, 5, 6]);
      },
    };
    const vanillaStore = new MemoryAssetStore(vanillaSource);

    const overlayStore = new OverlayAssetStore({
      packDirectory: packDir,
      vanillaStore,
    });

    const asciiBytes = await overlayStore.read("26.2", "minecraft:textures/font/ascii.png");
    expect(asciiBytes).toEqual(new Uint8Array([1, 2, 3]));

    const missingInPack = await overlayStore.read("26.2", "minecraft:font/default.json");
    expect(missingInPack).toEqual(new Uint8Array([4, 5, 6]));

    await rm(packDir, { recursive: true, force: true });
  });
});
