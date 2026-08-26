import { describe, expect, it } from "vitest";
import { createFont, deduplicateAdditionalCharacters } from "../../src/api/create-font";

describe("createFont API", () => {
  it("deduplicates additional custom characters against characterSet presets", () => {
    // 'A' and 'é' are already in 'latin'
    // '★' and '☆' are not in 'latin'
    const result = deduplicateAdditionalCharacters("Aé★☆", ["latin"]);
    expect(result.newCharacters).toBe("★☆");
    expect(result.newCodepoints).toEqual([0x2605, 0x2606]);
    expect(result.alreadyCoveredCount).toBe(2);
  });

  it("handles empty or covered additional characters gracefully", () => {
    const empty = deduplicateAdditionalCharacters("", ["latin"]);
    expect(empty.newCharacters).toBe("");
    expect(empty.alreadyCoveredCount).toBe(0);

    const allCovered = deduplicateAdditionalCharacters("ABC", ["ascii"]);
    expect(allCovered.newCharacters).toBe("");
    expect(allCovered.alreadyCoveredCount).toBe(3);
  });

  it("exposes createFont function returning an executable async generator", () => {
    const font = createFont({
      path: "./generated",
      styles: "all",
      characterSets: ["ascii"],
      format: "ttc",
      additionalChars: "★",
      minecraftVersion: "1.21",
    });

    expect(typeof font).toBe("function");
  });

  it("throws runtime error if styles is not 'all' for ttc format", async () => {
    const font = createFont({
      path: "./generated",
      styles: ["bold"] as any,
      characterSets: ["ascii"],
      format: "ttc",
      minecraftVersion: "1.21",
    });

    await expect(font()).rejects.toThrow(/For "ttc" format fonts, "styles" must be "all" or \["all"\]/);
  });

  it("supports resourcePack in createFont configuration without explicit minecraftVersion", () => {
    const font = createFont({
      path: "./generated",
      characterSets: ["latin"],
      resourcePack: "./resourcepack/Faithful 32x",
    });

    expect(typeof font).toBe("function");
  });

  it("supports single preset string or omitted characterSets defaulting to latin", () => {
    const fontSingle = createFont({
      path: "./generated",
      characterSets: "latin",
      minecraftVersion: "1.21",
    });
    expect(typeof fontSingle).toBe("function");

    const fontOmitted = createFont({
      path: "./generated",
      minecraftVersion: "1.21",
    });
    expect(typeof fontOmitted).toBe("function");

    const deduplicated = deduplicateAdditionalCharacters("★", "latin");
    expect(deduplicated.newCharacters).toBe("★");
  });
});
