import type { CharacterPreset } from "../core/generation";

export type CodepointRange = readonly [start: number, end: number];

export const PRESET_RANGES: Readonly<Record<Exclude<CharacterPreset, "all">, readonly CodepointRange[]>> = Object.freeze({
  ascii: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
  ]),
  latin: Object.freeze<CodepointRange[]>([
    [0x0020, 0x024f],
    [0x1e00, 0x1eff],
  ]),
  cyrillic: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x0400, 0x052f],
  ]),
  greek: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x0370, 0x03ff],
  ]),
  arabic: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
    [0x08a0, 0x08ff],
  ]),
  hebrew: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x0590, 0x05ff],
  ]),
  devanagari: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x0900, 0x097f],
  ]),
  thai: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x0e00, 0x0e7f],
  ]),
  korean: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x1100, 0x11ff],
    [0x3130, 0x318f],
    [0xac00, 0xd7af],
  ]),
  japanese: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x3000, 0x303f],
    [0x3040, 0x309f],
    [0x30a0, 0x30ff],
    [0x4e00, 0x9fff],
  ]),
  chinese: Object.freeze<CodepointRange[]>([
    [0x0020, 0x007e],
    [0x3000, 0x303f],
    [0x4e00, 0x9fff],
  ]),
  symbols: Object.freeze<CodepointRange[]>([
    [0x2000, 0x2bff], // Math, Technical, Arrows, Box drawing, Geometric, Misc Symbols
    [0x1f300, 0x1f9ff], // Emojis & Pictographs
  ]),
});

/** Returns whether a given Unicode codepoint belongs to the specified preset. */
export function isCodepointInPreset(codepoint: number, preset: CharacterPreset): boolean {
  if (preset === "all") {
    return true;
  }
  const ranges = PRESET_RANGES[preset];
  if (ranges === undefined) {
    return true;
  }
  for (const [start, end] of ranges) {
    if (codepoint >= start && codepoint <= end) {
      return true;
    }
  }
  return false;
}

/** Returns whether a given Unicode codepoint matches at least one of the specified presets. */
export function isCodepointInPresets(
  codepoint: number,
  presets: CharacterPreset | readonly CharacterPreset[],
): boolean {
  const list = typeof presets === "string" ? [presets] : presets;
  if (list.length === 0 || list.includes("all")) {
    return true;
  }
  for (const preset of list) {
    if (isCodepointInPreset(codepoint, preset)) {
      return true;
    }
  }
  return false;
}

/** Filters an array of codepoints according to one or more character presets. */
export function filterCodepointsByPresets(
  codepoints: readonly number[],
  presets: CharacterPreset | readonly CharacterPreset[],
): number[] {
  const list = typeof presets === "string" ? [presets] : presets;
  if (list.length === 0 || list.includes("all")) {
    return [...codepoints];
  }
  return codepoints.filter((cp) => isCodepointInPresets(cp, list));
}
