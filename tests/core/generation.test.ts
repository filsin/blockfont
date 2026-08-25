import { describe, expect, it } from "vitest";

import { createFontGenerationOptions } from "../../src/core/generation";

describe("generation options", () => {
  it("validates the typed version and output inputs without I/O", () => {
    expect(
      createFontGenerationOptions({
        minecraftVersion: "1.21.4",
        outputDirectory: "./dist/fonts",
        styles: ["regular", "bold"],
        formats: ["ttf"],
      }),
    ).toEqual({
      minecraftVersion: "1.21.4",
      outputDirectory: "./dist/fonts",
      styles: ["regular", "bold"],
      formats: ["ttf"],
    });
  });

  it("rejects empty required inputs", () => {
    expect(() =>
      createFontGenerationOptions({
        minecraftVersion: "",
        outputDirectory: "./dist/fonts",
      }),
    ).toThrow(RangeError);
  });

  it("validates supported values and freezes copied option lists", () => {
    const styles = ["regular", "bold"] as const;
    const options = createFontGenerationOptions({
      minecraftVersion: "1.21.4",
      outputDirectory: "./dist/fonts",
      styles,
      formats: ["ttf"],
    });

    expect(options.styles).toEqual(["regular", "bold"]);
    expect(Object.isFrozen(options.styles)).toBe(true);
    expect(() =>
      createFontGenerationOptions({
        minecraftVersion: "1.21.4",
        outputDirectory: "./dist/fonts",
        styles: ["regular", "regular"],
      }),
    ).toThrow(RangeError);
  });
});
