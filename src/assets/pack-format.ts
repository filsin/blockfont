import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PackMcmetaData {
  readonly packFormat: number;
  readonly description?: string | undefined;
  readonly supportedFormats?: readonly number[] | { readonly min_inclusive: number; readonly max_inclusive: number } | undefined;
}

/**
 * Reads and parses `pack.mcmeta` from an unzipped resource pack directory.
 */
export function parsePackMcmeta(packPath: string): PackMcmetaData {
  const mcmetaPath = join(packPath, "pack.mcmeta");
  if (!existsSync(mcmetaPath)) {
    throw new Error(`Invalid resource pack: missing pack.mcmeta at ${mcmetaPath}`);
  }

  let content: unknown;
  try {
    const rawJson = readFileSync(mcmetaPath, "utf-8").replace(/^\uFEFF/, "").trim();
    content = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`Failed to parse pack.mcmeta at ${mcmetaPath}: ${String(err)}`);
  }

  if (typeof content !== "object" || content === null || !("pack" in content)) {
    throw new Error(`Invalid pack.mcmeta structure in ${mcmetaPath}: missing "pack" root key`);
  }

  const packObj = (content as Record<string, unknown>).pack as Record<string, unknown>;
  const packFormat = typeof packObj.pack_format === "number" ? packObj.pack_format : 1;
  const description = typeof packObj.description === "string" ? packObj.description : undefined;

  return {
    packFormat,
    description,
    supportedFormats: packObj.supported_formats as PackMcmetaData["supportedFormats"],
  };
}

/**
 * Maps a Minecraft resource pack `pack_format` to the corresponding default Minecraft release version.
 * 
 * Historical mapping:
 * - Format 1: 1.6.1 – 1.12.2 (Legacy)
 * - Format 2: 1.9 – 1.10.2
 * - Format 3: 1.11 – 1.12.2
 * - Format 4: 1.13 – 1.14.4
 * - Format 5: 1.15 – 1.16.1
 * - Format 6: 1.16.2 – 1.16.5
 * - Format 7: 1.17 – 1.17.1
 * - Format 8: 1.18 – 1.18.2
 * - Format 9: 1.19 – 1.19.2
 * - Format 12: 1.19.3 – 1.19.4
 * - Format 13: 1.19.4
 * - Format 15: 1.20 – 1.20.1
 * - Format 18: 1.20.2
 * - Format 22: 1.20.3 – 1.20.4
 * - Format 32: 1.20.5 – 1.20.6
 * - Format 34: 1.21 – 1.21.1
 * - Format 42: 1.21.2 – 1.21.3
 * - Format 46: 1.21.4
 * - Format 88: 26.2 (Latest)
 */
export function mapPackFormatToMinecraftVersion(packFormat: number): string {
  if (packFormat <= 1) return "1.8.9";
  if (packFormat === 2) return "1.10.2";
  if (packFormat === 3) return "1.12.2";
  if (packFormat === 4) return "1.13.2";
  if (packFormat === 5) return "1.15.2";
  if (packFormat === 6) return "1.16.5";
  if (packFormat === 7) return "1.17.1";
  if (packFormat === 8) return "1.18.2";
  if (packFormat >= 9 && packFormat <= 14) return "1.19.4";
  if (packFormat >= 15 && packFormat <= 22) return "1.20.4";
  if (packFormat >= 23 && packFormat <= 33) return "1.20.6";
  if (packFormat >= 34 && packFormat <= 41) return "1.21.1";
  if (packFormat >= 42 && packFormat <= 45) return "1.21.3";
  if (packFormat >= 46 && packFormat <= 87) return "1.21.4";
  return "26.2";
}
