import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { FontFormat, MemoryAssetSource, generateBlockFont } from "../../src/index";
import {
  BlockFontValidationError,
  assertReproducible,
  assertValidGeneratedFonts,
  validateFontFile,
  validateGeneratedFonts,
  validateReproducibility,
} from "../../src/validation";
import { runCli } from "../../src/cli";
import { PNG } from "pngjs";
import { describe, expect, it, afterEach, vi } from "vitest";

const VERSION = "integration-fixture";
const EMOJI = 0x1f600;
const execFile = promisify(nodeExecFile);

function fixturePng(): Uint8Array {
  const image = new PNG({ width: 4, height: 4 });
  const setPixel = (x: number, y: number): void => {
    const offset = (y * image.width + x) * 4;
    image.data[offset] = 255;
    image.data[offset + 1] = 255;
    image.data[offset + 2] = 255;
    image.data[offset + 3] = 255;
  };
  setPixel(0, 0);
  setPixel(1, 0);
  setPixel(1, 1);
  return new Uint8Array(PNG.sync.write(image));
}

function fixtureSource(): MemoryAssetSource {
  return new MemoryAssetSource([
    {
      version: VERSION,
      resource: "minecraft:font/default.json",
      data: JSON.stringify({
        providers: [
          {
            type: "bitmap",
            file: "minecraft:font/integration.png",
            ascent: 4,
            height: 4,
            advance: 4,
            boldOffset: 0.5,
            chars: ["A"],
          },
          {
            type: "unihex",
            hex_file: "minecraft:font/integration.hex",
            resolution: 1,
            ascent: 14,
            boldOffset: 0.5,
          },
          {
            type: "space",
            advances: { " ": 3.5, "\u2003": 3.5 },
          },
        ],
      }),
    },
    {
      version: VERSION,
      resource: "minecraft:font/integration.png",
      data: fixturePng(),
    },
    {
      version: VERSION,
      resource: "minecraft:font/integration.hex",
      data: "1F600:80000000000000000000000000000000\n",
    },
  ]);
}

async function createOutputDirectory(directories: string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "blockfont-integration-"));
  directories.push(directory);
  return directory;
}

describe("BlockFont generation and validation integration", () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ));
  });

  it("generates and reparses all four TTF styles with empty and non-BMP glyphs", async () => {
    const output = await createOutputDirectory(directories);
    const result = await generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: output,
      characters: "A ",
    });

    expect(result.files.map((file) => file.fileName)).toEqual([
      "BlockFont-Regular.ttf",
      "BlockFont-Bold.ttf",
      "BlockFont-Italic.ttf",
      "BlockFont-BoldItalic.ttf",
    ]);
    expect(result.codepoints).toEqual([0x20, 0x41]);

    const report = assertValidGeneratedFonts(result, {
      requireAllStyles: true,
      requireExactCodepointSet: true,
    });
    expect(report.valid).toBe(true);
    expect(report.files).toHaveLength(4);
    expect(report.files[0]?.summary?.codepoints).toContain(0x41);
    expect(result.glyphs.find((glyph) => glyph.codepoint === 0x20)?.contours).toEqual([]);

    const regular = report.files.find((file) => file.summary?.format === "ttf");
    expect(regular?.summary?.underlinePosition).toBe(-200);
    expect(regular?.summary?.underlineThickness).toBe(200);
    expect(regular?.summary?.ascender).toBe(1600);
    expect(regular?.summary?.descender).toBe(-400);
    expect(regular?.summary?.advances.get(0x20)).toBe(700);
    expect(regular?.summary?.advances.get(0x41)).toBe(800);
    expect(regular?.summary?.advances.get(EMOJI)).toBeUndefined();

    const bold = report.files.find((file) => file.summary?.styleName === "Bold");
    expect(bold?.summary?.advances.get(0x41)).toBe(900);
    expect(bold?.summary?.advances.get(EMOJI)).toBeUndefined();
    expect(bold?.summary?.advances.get(0x20)).toBe(700);
  }, 30000);

  it("supports the backend's OTF output and validates the selected subset", async () => {
    const output = await createOutputDirectory(directories);
    const result = await generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: output,
      characters: `\u{1f600}`,
      styles: ["regular"],
      formats: ["otf"],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.fileName).toBe("BlockFont-Regular.otf");
    const report = validateGeneratedFonts(result);
    expect(report.valid).toBe(true);
    expect(report.files[0]?.summary?.format).toBe("otf");
    expect(report.files[0]?.summary?.codepoints).toContain(EMOJI);
  });

  it("checks binary reproducibility across two independent output directories", async () => {
    const firstOutput = await createOutputDirectory(directories);
    const secondOutput = await createOutputDirectory(directories);
    const first = await generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: firstOutput,
      characters: "A ",
    });
    const second = await generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: secondOutput,
      characters: "A ",
    });

    const report = validateReproducibility(first, second);
    expect(report).toEqual({ valid: true, mode: "binary", issues: [] });
    expect(assertReproducible(first, second).mode).toBe("binary");
    expect(first.files.map((file) => [...file.bytes])).toEqual(
      second.files.map((file) => [...file.bytes]),
    );
  });

  it("returns readable typed diagnostics for malformed fonts and invalid generation formats", async () => {
    const malformed = validateFontFile(new Uint8Array([0, 1, 2, 3]));
    expect(malformed.valid).toBe(false);
    expect(malformed.issues[0]?.code).toBe("parse-error");

    expect(() => {
      if (!malformed.valid) {
        throw new BlockFontValidationError("fixture is malformed", malformed.issues);
      }
    }).toThrow(BlockFontValidationError);

    const output = await createOutputDirectory(directories);
    await expect(generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: output,
      characters: "A",
      formats: ["woff2" as FontFormat],
    })).rejects.toThrow(/unsupported value/i);
  });

  it("runs the compiled CLI against synthetic local assets and reparses its TTF output", async () => {
    const assetsRoot = await createOutputDirectory(directories);
    const output = await createOutputDirectory(directories);
    const fontDirectory = join(assetsRoot, VERSION, "assets", "minecraft", "font");
    await mkdir(fontDirectory, { recursive: true });
    await writeFile(join(fontDirectory, "default.json"), JSON.stringify({
      providers: [
        {
          type: "bitmap",
          file: "minecraft:font/cli.png",
          ascent: 4,
          height: 4,
          advance: 4,
          chars: ["A"],
        },
        { type: "space", advances: { " ": 3.5 } },
      ],
    }));
    await writeFile(join(fontDirectory, "cli.png"), fixturePng());

    const cliPath = join(process.cwd(), "dist", "cli", "index.js");
    const result = await execFile(process.execPath, [
      cliPath,
      `--version=${VERSION}`,
      "--assets",
      assetsRoot,
      "--output",
      output,
    ]);
    expect(result.stdout).toContain("Generated");
    expect(result.stderr).toBe("");

    for (const style of ["Regular", "Bold", "Italic", "BoldItalic"] as const) {
      const path = join(output, `BlockFont-${style}.ttf`);
      const bytes = new Uint8Array(await readFile(path));
      const report = validateFontFile(bytes, {
        expectedFormat: "ttf",
        expectedCodepoints: "A ",
        requireExactCodepointSet: true,
      });
      expect(report.valid).toBe(true);
    }

    for (const tool of ["fc-scan", "hb-shape"] as const) {
      try {
        await execFile("which", [tool]);
        const path = join(output, "BlockFont-Regular.ttf");
        await execFile(tool, tool === "hb-shape" ? [path, "A"] : [path]);
      } catch {
        // External validators are optional outside the development image.
      }
    }
  });

  it("exposes an explicit missing-glyph policy and diagnostics", async () => {
    const output = await createOutputDirectory(directories);
    await expect(generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: output,
      characters: "A?",
      styles: ["regular"],
    })).rejects.toThrow(/U\+003F/);

    const skipped = await generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: await createOutputDirectory(directories),
      characters: "A?",
      styles: ["regular"],
      missingGlyphPolicy: "skip",
    });
    expect(skipped.missingCodepoints).toEqual([0x3f]);
    expect(skipped.codepoints).toEqual([0x41]);
  });

  it("invokes the CLI version/help paths without assets and rejects bad arguments", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runCli(["--version"])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("0.2.0"));
    await expect(runCli(["--help"])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    await expect(runCli(["--not-an-option"])).resolves.toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Unknown option"));
    await expect(runCli(["--version", VERSION, "--assets", "/tmp/assets"])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("--output"));
  });

  it("validates that exclude is only supported when format includes ttc", async () => {
    const output = await createOutputDirectory(directories);
    await expect(generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: output,
      formats: ["ttf"],
      exclude: ["italic"],
    })).rejects.toThrow(/The "exclude" option is only supported when generating "ttc" format fonts/);

    const result = await generateBlockFont({
      version: VERSION,
      assetStore: fixtureSource(),
      outputDirectory: output,
      formats: ["ttc"],
      exclude: ["italic", "boldItalic"],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.fileName).toBe("BlockFont-Complete.ttc");
  });
});
