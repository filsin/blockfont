import { Font, Glyph, Path } from "opentype.js";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import {
  MemoryAssetSource,
  type AssetStore,
  type ResourceLocationInput,
} from "../../src/assets";
import {
  InvalidProviderError,
  MinecraftFontResolver,
  UnsupportedProviderError,
  parseFontDefinition,
} from "../../src/providers";
import { makeUnihexZipFixture } from "./fixtures/zip-fixtures";

const VERSION = "fixture-version";

function makeFixturePng(): Uint8Array {
  const image = new PNG({ width: 4, height: 4 });
  const setPixel = (x: number, y: number): void => {
    const index = (y * image.width + x) * 4;
    image.data[index] = 255;
    image.data[index + 1] = 255;
    image.data[index + 2] = 255;
    image.data[index + 3] = 255;
  };
  setPixel(0, 0);
  setPixel(1, 1);
  return new Uint8Array(PNG.sync.write(image));
}

function makeFixtureTtf(): Uint8Array {
  const notdefPath = new Path();
  const curvePath = new Path();
  curvePath.unitsPerEm = 1000;
  curvePath.moveTo(0, 0);
  curvePath.quadraticCurveTo(250, 500, 500, 0);
  curvePath.closePath();
  const font = new Font({
    familyName: "Fixture",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new Glyph({ name: ".notdef", advanceWidth: 1000, path: notdefPath }),
      new Glyph({ name: "C", unicode: 67, advanceWidth: 1000, path: curvePath }),
      new Glyph({ name: "D", unicode: 68, advanceWidth: 700, path: curvePath }),
    ],
  });
  return new Uint8Array(font.toArrayBuffer());
}

function makeStore(): MemoryAssetSource {
  const defaultJson = JSON.stringify({
    providers: [
      {
        type: "bitmap",
        file: "minecraft:font/fixture.png",
        ascent: 3,
        height: 4,
        boldOffset: 0.5,
        advance: 4,
        chars: ["A "],
      },
      {
        type: "unihex",
        hex_file: "minecraft:font/fixture.hex",
        resolution: 1,
        ascent: 14,
        boldOffset: 0.5,
        size_overrides: [{ from: "00E9", to: "00E9", left: 1, right: 1 }],
      },
      { type: "space", advances: { "\u2003": 3.5 } },
      { type: "reference", id: "minecraft:include/reference" },
      {
        type: "ttf",
        file: "minecraft:font/fixture.ttf",
        size: 16,
        coordinateRounding: "round",
      },
    ],
  });
  return new MemoryAssetSource([
    { version: VERSION, resource: "minecraft:font/default.json", data: defaultJson },
    {
      version: VERSION,
      resource: "minecraft:font/include/reference.json",
      data: JSON.stringify({ providers: [{ type: "space", advances: { B: 2.5 } }] }),
    },
    {
      version: VERSION,
      resource: "minecraft:font/fixture.hex",
      data: "00E9:80000000000000000000000000000000\n",
    },
    { version: VERSION, resource: "minecraft:font/fixture.png", data: makeFixturePng() },
    { version: VERSION, resource: "minecraft:font/fixture.ttf", data: makeFixtureTtf() },
  ]);
}

function makeHighResolutionPng(): Uint8Array {
  const image = new PNG({ width: 8, height: 8 });
  const index = (0 * image.width + 3) * 4;
  image.data[index] = 255;
  image.data[index + 1] = 255;
  image.data[index + 2] = 255;
  image.data[index + 3] = 255;
  return new Uint8Array(PNG.sync.write(image));
}

function makeCountingStore(): {
  readonly store: AssetStore;
  readonly count: (resource: string) => number;
} {
  const source = makeStore();
  const reads = new Map<string, number>();
  const read = async (version: string, resource: ResourceLocationInput): Promise<Uint8Array> => {
    const resourceId = typeof resource === "string"
      ? resource
      : `${resource.namespace}:${resource.path}`;
    reads.set(resourceId, (reads.get(resourceId) ?? 0) + 1);
    return source.read(version, resource);
  };
  return {
    store: { read, get: read },
    count: (resource) => reads.get(resource) ?? 0,
  };
}

describe("Minecraft font providers", () => {
  it("parses provider definitions and rejects malformed/unknown types", () => {
    expect(parseFontDefinition({
      providers: [{ type: "space", advances: { " ": 4 } }],
    }).providers[0]?.type).toBe("space");
    expect(() => parseFontDefinition({ providers: [{ type: "bitmap" }] }))
      .toThrow(InvalidProviderError);
    expect(() => parseFontDefinition({
      providers: [{ type: "reference", id: "../escape" }],
    })).toThrow(InvalidProviderError);
    expect(() => parseFontDefinition({
      providers: [{
        type: "bitmap",
        file: "minecraft:font/../escape.png",
        ascent: 1,
        chars: ["A"],
      }],
    })).toThrow(InvalidProviderError);
    expect(() => parseFontDefinition({ providers: [{ type: "future" }] }))
      .toThrow(UnsupportedProviderError);
  });

  it("resolves bitmap pixels with pngjs and keeps the explicit advance", async () => {
    const resolver = new MinecraftFontResolver({ store: makeStore(), minecraftVersion: VERSION });
    const glyph = await resolver.resolveGlyph(0x41);
    expect(glyph).toBeDefined();
    expect(glyph?.contours).toHaveLength(2);
    expect(glyph?.metrics).toEqual({
      advance: 800,
      boldOffset: 100,
      bearingLeft: 0,
      bearingTop: 600,
    });
    expect(glyph?.bounds).toEqual({ xMin: 0, yMin: 200, xMax: 400, yMax: 600 });
  });

  it("scales bitmap fallback padding with a high-resolution source", async () => {
    const version = "high-resolution";
    const store = new MemoryAssetSource([
      {
        version,
        resource: "minecraft:font/default.json",
        data: JSON.stringify({
          providers: [{
            type: "bitmap",
            file: "minecraft:font/high-resolution.png",
            ascent: 3,
            height: 4,
            chars: ["A"],
          }],
        }),
      },
      {
        version,
        resource: "minecraft:font/high-resolution.png",
        data: makeHighResolutionPng(),
      },
    ]);
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: version });
    const glyph = await resolver.resolveGlyph(0x41);
    expect(glyph?.metrics.advance).toBe(500);
    expect(glyph?.bounds).toEqual({ xMin: 300, yMin: 500, xMax: 400, yMax: 600 });
  });

  it("resolves Unicode Unihex rows and preserves width, override bearings and half-pixel boldOffset", async () => {
    const resolver = new MinecraftFontResolver({ store: makeStore(), minecraftVersion: VERSION });
    const glyph = await resolver.resolveGlyph(0xE9);
    expect(glyph?.metrics.advance).toBe(1200);
    expect(glyph?.metrics.boldOffset).toBe(100);
    expect(glyph?.metrics.bearingLeft).toBe(200);
    expect(glyph?.bounds?.xMin).toBe(-200);
    expect(glyph?.bounds?.xMax).toBe(0);
  });

  it.each([4, 8, 12, 16] as const)("decodes Unihex width %d without byte-alignment assumptions", async (width) => {
    const row = "8" + "0".repeat(Math.ceil(width / 4) - 1);
    const emptyRow = "0".repeat(Math.ceil(width / 4));
    const version = `unihex-width-${width}`;
    const store = new MemoryAssetSource([
      {
        version,
        resource: "minecraft:font/default.json",
        data: JSON.stringify({
          providers: [{ type: "unihex", hex_file: "minecraft:font/width.hex" }],
        }),
      },
      {
        version,
        resource: "minecraft:font/width.hex",
        data: `0041:${row}${emptyRow.repeat(15)}\n`,
      },
    ]);
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: version });
    const glyph = await resolver.resolveGlyph(0x41);
    expect(glyph?.contours).toHaveLength(1);
    expect(glyph?.bounds?.xMax).toBe(200);
  });

  it("resolves space and reference providers without inventing contours", async () => {
    const resolver = new MinecraftFontResolver({ store: makeStore(), minecraftVersion: VERSION });
    const space = await resolver.resolveGlyph(0x2003);
    expect(space?.contours).toEqual([]);
    expect(space?.metrics.advance).toBe(700);
    expect(space?.metrics.boldOffset).toBe(0);

    const referenced = await resolver.resolveGlyph(0x42);
    expect(referenced?.contours).toEqual([]);
    expect(referenced?.metrics.advance).toBe(500);
  });

  it.each([
    { compression: "stored" as const, dataDescriptor: true },
    { compression: "deflate" as const, dataDescriptor: true },
    { compression: "deflate" as const, dataDescriptor: false },
  ])("reads Unihex ZIP $compression entries with descriptor=$dataDescriptor", async (options) => {
    const version = `zip-${options.compression}-${options.dataDescriptor ? "descriptor" : "header"}`;
    const store = new MemoryAssetSource([
      {
        version,
        resource: "minecraft:font/default.json",
        data: JSON.stringify({
          providers: [{ type: "unihex", hex_file: "minecraft:font/fixture.zip" }],
        }),
      },
      {
        version,
        resource: "minecraft:font/fixture.zip",
        data: makeUnihexZipFixture(options),
      },
    ]);
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: version });
    const glyph = await resolver.resolveGlyph(0xE9);
    expect(glyph?.contours).toHaveLength(1);
    expect(glyph?.metrics.advance).toBe(1600);
  });

  it("reports a truncated Unihex ZIP instead of parsing partial data", async () => {
    const version = "zip-invalid";
    const archive = makeUnihexZipFixture({ compression: "deflate", dataDescriptor: true });
    const store = new MemoryAssetSource([
      {
        version,
        resource: "minecraft:font/default.json",
        data: JSON.stringify({
          providers: [{ type: "unihex", hex_file: "minecraft:font/fixture.zip" }],
        }),
      },
      {
        version,
        resource: "minecraft:font/fixture.zip",
        data: archive.slice(0, -1),
      },
    ]);
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: version });
    await expect(resolver.resolveGlyph(0xE9)).rejects.toThrow(InvalidProviderError);
  });

  it("loads TTF providers asynchronously while preserving parsed curve commands", async () => {
    const resolver = new MinecraftFontResolver({ store: makeStore(), minecraftVersion: VERSION });
    const glyph = await resolver.resolveGlyph(0x43);
    expect(glyph?.contours).toHaveLength(1);
    // opentype.js writes TrueType quadratics as equivalent cubic commands;
    // the provider preserves that parsed curve instead of flattening it.
    expect(glyph?.contours[0]?.segments.some((segment) => segment.type === "cubic")).toBe(true);
    expect(glyph?.metrics.advance).toBe(3200);
  });

  it("applies coordinateRounding to TTF metrics as well as outline coordinates", async () => {
    const store = makeStore();
    store.set(VERSION, "minecraft:font/default.json", JSON.stringify({
      providers: [{
        type: "ttf",
        file: "minecraft:font/fixture.ttf",
        size: 16,
        coordinateRounding: "round",
      }],
    }));
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: VERSION });
    const glyph = await resolver.resolveGlyph(0x44);
    expect(glyph?.metrics.advance).toBe(2240);
  });

  it("rejects non-integral TTF coordinates unless rounding is explicitly configured", async () => {
    const store = makeStore();
    store.set(VERSION, "minecraft:font/default.json", JSON.stringify({
      providers: [{
        type: "ttf",
        file: "minecraft:font/fixture.ttf",
        size: 16,
      }],
    }));
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: VERSION });
    await expect(resolver.resolveGlyph(0x43)).rejects.toThrow(/not representable/);
  });

  it("caches provider instances and their parsed assets per version and font id", async () => {
    const counted = makeCountingStore();
    const resolver = new MinecraftFontResolver({
      store: counted.store,
      minecraftVersion: VERSION,
    });
    await resolver.resolveGlyph(0x41);
    await resolver.resolveGlyph(0x41);
    expect(counted.count("minecraft:font/default.json")).toBe(1);
    expect(counted.count("minecraft:font/fixture.png")).toBe(1);
  });

  it("returns undefined for uncovered codepoints and detects reference cycles", async () => {
    const store = makeStore();
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: VERSION });
    await expect(resolver.resolveGlyph(0x2603)).resolves.toBeUndefined();

    store.set(VERSION, "minecraft:font/cycle-a.json", JSON.stringify({
      providers: [{ type: "reference", id: "minecraft:cycle-b" }],
    }));
    store.set(VERSION, "minecraft:font/cycle-b.json", JSON.stringify({
      providers: [{ type: "reference", id: "minecraft:cycle-a" }],
    }));
    await expect(resolver.resolveGlyph(65, "minecraft:cycle-a"))
      .rejects.toThrow(/Cyclic font reference/);
  });

  it("rejects unsupported TTF oversampling and invalid Unicode definition values", () => {
    expect(() => parseFontDefinition({
      providers: [{ type: "ttf", file: "minecraft:font/fixture.ttf", oversample: 4 }],
    })).toThrow(UnsupportedProviderError);
    expect(() => parseFontDefinition({
      providers: [{ type: "unihex", hex_file: "minecraft:font/fixture.hex", size_overrides: [
        { from: 0xd800, to: 0xd800, left: 0, right: 0 },
      ] }],
    })).toThrow(InvalidProviderError);
    expect(() => parseFontDefinition({
      providers: [{ type: "bitmap", file: "minecraft:font/fixture.png", ascent: 1, chars: ["\ud800"] }],
    })).toThrow(InvalidProviderError);
  });

  it("resolves simple hexadecimal space map keys", async () => {
    const version = "space-hex-key";
    const store = new MemoryAssetSource([{
      version,
      resource: "minecraft:font/default.json",
      data: JSON.stringify({ providers: [{ type: "space", advances: { "0041": 2 } }] }),
    }]);
    const resolver = new MinecraftFontResolver({ store, minecraftVersion: version });
    const glyph = await resolver.resolveGlyph(0x41);
    expect(glyph?.metrics.advance).toBe(400);
  });
});
