import { describe, expect, it } from "vitest";
import { fastDeflateSync, fastInflateSync, fastWriteFile } from "../../src/utils/bun-compat";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

describe("Bun / Node Compatibility Layer (bun-compat)", () => {
  it("compresses and decompresses data transparently with zlib SIMD/fallback", () => {
    const originalText = "Hello BlockFont performance optimization engine!";
    const input = new TextEncoder().encode(originalText);

    const compressed = fastDeflateSync(input);
    expect(compressed.length).toBeGreaterThan(0);

    const decompressed = fastInflateSync(compressed);
    const restoredText = new TextDecoder().decode(decompressed);
    expect(restoredText).toBe(originalText);
  });

  it("writes binary files to disk seamlessly across Bun and Node environments", async () => {
    const testPath = resolve(process.cwd(), ".cache", "test_bun_write.tmp");
    const data = new TextEncoder().encode("BlockFont Bun Fast I/O");

    await fastWriteFile(testPath, data);
    expect(existsSync(testPath)).toBe(true);

    const readBack = readFileSync(testPath, "utf-8");
    expect(readBack).toBe("BlockFont Bun Fast I/O");

    try {
      rmSync(testPath);
    } catch {
      // Cleanup
    }
  });
});
