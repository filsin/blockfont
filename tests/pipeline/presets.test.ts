import { describe, expect, it } from "vitest";
import { filterCodepointsByPresets, isCodepointInPreset, isCodepointInPresets } from "../../src/pipeline/presets";

describe("presets", () => {
  it("correctly identifies ASCII codepoints", () => {
    expect(isCodepointInPreset(0x0041, "ascii")).toBe(true); // 'A'
    expect(isCodepointInPreset(0x0020, "ascii")).toBe(true); // ' '
    expect(isCodepointInPreset(0x00e9, "ascii")).toBe(false); // 'é'
    expect(isCodepointInPreset(0x0410, "ascii")).toBe(false); // Cyrillic 'А'
  });

  it("correctly identifies European Latin codepoints", () => {
    expect(isCodepointInPreset(0x0041, "latin")).toBe(true); // 'A'
    expect(isCodepointInPreset(0x00e9, "latin")).toBe(true); // 'é'
    expect(isCodepointInPreset(0x0142, "latin")).toBe(true); // Polish 'ł'
    expect(isCodepointInPreset(0x0410, "latin")).toBe(false); // Cyrillic 'А'
  });

  it("correctly identifies Cyrillic codepoints", () => {
    expect(isCodepointInPreset(0x0410, "cyrillic")).toBe(true); // Cyrillic 'А'
    expect(isCodepointInPreset(0x044f, "cyrillic")).toBe(true); // Cyrillic 'я'
  });

  it("correctly identifies Greek, Arabic, Hebrew, Devanagari, Thai, Symbols & Emojis codepoints", () => {
    expect(isCodepointInPreset(0x03b1, "greek")).toBe(true); // Greek 'α'
    expect(isCodepointInPreset(0x0627, "arabic")).toBe(true); // Arabic 'ا'
    expect(isCodepointInPreset(0x05d0, "hebrew")).toBe(true); // Hebrew 'א'
    expect(isCodepointInPreset(0x0905, "devanagari")).toBe(true); // Devanagari 'अ'
    expect(isCodepointInPreset(0x0e01, "thai")).toBe(true); // Thai 'ก'
    expect(isCodepointInPreset(0x221e, "symbols")).toBe(true); // Infinity '∞'
    expect(isCodepointInPreset(0x221e, "emojis")).toBe(false);
    expect(isCodepointInPreset(0x1f600, "emojis")).toBe(true); // 😀
    expect(isCodepointInPreset(0x1f600, "symbols")).toBe(false);
  });

  it("combines multiple presets together", () => {
    const list = [0x0041, 0x00e9, 0x0410, 0x03b1, 0x4e00];
    expect(isCodepointInPresets(0x0410, ["latin", "cyrillic"])).toBe(true);
    expect(filterCodepointsByPresets(list, ["latin", "cyrillic"])).toEqual([0x0041, 0x00e9, 0x0410]);
    expect(filterCodepointsByPresets(list, ["latin", "greek"])).toEqual([0x0041, 0x00e9, 0x03b1]);
  });
});
