import { describe, expect, it } from "vitest";
import { generateBlockFont } from "../../src/pipeline/generate";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Resource Pack & Multi-Version Integration", () => {
  it("automatically deduces version from pack.mcmeta format and overlays custom textures", async () => {
    const packDir = join(tmpdir(), `test_pack_e2e_${Date.now()}`);
    const outDir = join(tmpdir(), `test_pack_out_${Date.now()}`);

    // Create resource pack structure with pack.mcmeta format 15 (Minecraft 1.20)
    await mkdir(join(packDir, "assets/minecraft/textures/font"), { recursive: true });
    await writeFile(
      join(packDir, "pack.mcmeta"),
      JSON.stringify({ pack: { pack_format: 15, description: "Test Resource Pack" } }),
    );

    // Create a 16x16 PNG texture for ascii
    const PNG = (await import("pngjs")).PNG;
    const png = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 255;     // R
      png.data[i + 1] = 255; // G
      png.data[i + 2] = 255; // B
      png.data[i + 3] = 255; // Alpha
    }
    await writeFile(join(packDir, "assets/minecraft/textures/font/ascii.png"), PNG.sync.write(png));

    const result = await generateBlockFont({
      resourcePack: packDir,
      outputDirectory: outDir,
      characters: "A",
    });

    expect(result.version).toBe("1.20.4");
    expect(result.files.length).toBeGreaterThan(0);

    await rm(packDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });
});
