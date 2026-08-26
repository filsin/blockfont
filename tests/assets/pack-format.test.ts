import { describe, expect, it } from "vitest";
import { mapPackFormatToMinecraftVersion, parsePackMcmeta } from "../../src/assets/pack-format";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Pack Format & Version Detection", () => {
  it("maps pack formats accurately to default Minecraft versions", () => {
    expect(mapPackFormatToMinecraftVersion(1)).toBe("1.8.9");
    expect(mapPackFormatToMinecraftVersion(4)).toBe("1.13.2");
    expect(mapPackFormatToMinecraftVersion(6)).toBe("1.16.5");
    expect(mapPackFormatToMinecraftVersion(15)).toBe("1.20.4");
    expect(mapPackFormatToMinecraftVersion(46)).toBe("1.21.4");
    expect(mapPackFormatToMinecraftVersion(88)).toBe("26.2");
  });

  it("parses valid pack.mcmeta files", async () => {
    const packDir = join(tmpdir(), `test_pack_${Date.now()}`);
    await mkdir(packDir, { recursive: true });
    await writeFile(
      join(packDir, "pack.mcmeta"),
      JSON.stringify({ pack: { pack_format: 15, description: "Test Resource Pack" } }),
    );

    const parsed = parsePackMcmeta(packDir);
    expect(parsed.packFormat).toBe(15);
    expect(parsed.description).toBe("Test Resource Pack");

    await rm(packDir, { recursive: true, force: true });
  });
});
