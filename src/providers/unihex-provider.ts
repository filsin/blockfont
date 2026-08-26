import { inflateRawSync } from "node:zlib";

import { vectorizeBitmapAsCoreContours } from "../geometry/vectorize";
import { minecraftRelativeYToOpenTypeY, minecraftToFontUnits } from "../core/units";
import type { MinecraftGlyph } from "../core";
import { readAssetBytes } from "../assets";
import { InvalidProviderError } from "./errors";
import type {
  UnihexProviderDefinition,
  UnihexSizeOverride,
} from "./font-definition";
import {
  assertUnicodeScalar,
  createProviderGlyph,
  createSourcePixelContour,
  lookupProviderNumber,
  type GlyphProvider,
  type ProviderContext,
} from "./provider-utils";

interface UnihexRecord {
  readonly codepoint: number;
  readonly width: number;
  readonly rows: readonly Uint8Array[];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeZipName(bytes: Uint8Array, flags: number): string {
  try {
    // Real Minecraft Unihex archives use ASCII/UTF-8 entry names. Rejecting
    // undecodable names is safer than guessing a path and reading the wrong
    // member from an archive with an unsupported legacy filename encoding.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new InvalidProviderError(
      `Unihex ZIP entry name is not valid ${flags & 0x800 ? "UTF-8" : "UTF-8/ASCII"}`,
      "unihex",
      undefined,
      undefined,
      error,
    );
  }
}

function decodeZipEntries(bytes: Uint8Array): readonly Uint8Array[] {
  const endOfCentralDirectorySignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  const localFileSignature = 0x04034b50;
  const minimumEndOffset = Math.max(0, bytes.length - 22 - 0xffff);
  let endOfCentralDirectory = -1;
  for (let offset = bytes.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (readUint32LE(bytes, offset) === endOfCentralDirectorySignature) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  if (endOfCentralDirectory < 0 || endOfCentralDirectory + 22 > bytes.length) {
    throw new InvalidProviderError(
      "Unihex ZIP is missing a valid end-of-central-directory record",
      "unihex",
    );
  }

  const diskNumber = readUint16LE(bytes, endOfCentralDirectory + 4);
  const centralDirectoryDisk = readUint16LE(bytes, endOfCentralDirectory + 6);
  const entriesOnDisk = readUint16LE(bytes, endOfCentralDirectory + 8);
  const entryCount = readUint16LE(bytes, endOfCentralDirectory + 10);
  const centralDirectorySize = readUint32LE(bytes, endOfCentralDirectory + 12);
  const centralDirectoryOffset = readUint32LE(bytes, endOfCentralDirectory + 16);
  const commentLength = readUint16LE(bytes, endOfCentralDirectory + 20);
  if (endOfCentralDirectory + 22 + commentLength > bytes.length) {
    throw new InvalidProviderError("Unihex ZIP comment is truncated", "unihex");
  }
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount
  ) {
    throw new InvalidProviderError(
      "Multi-disk Unihex ZIP archives are unsupported",
      "unihex",
    );
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new InvalidProviderError("ZIP64 Unihex archives are unsupported", "unihex");
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset > bytes.length ||
    centralDirectoryEnd > bytes.length ||
    centralDirectoryEnd < centralDirectoryOffset
  ) {
    throw new InvalidProviderError("Unihex ZIP central directory is truncated", "unihex");
  }

  const entries: Uint8Array[] = [];
  let centralOffset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > centralDirectoryEnd) {
      throw new InvalidProviderError("Unihex ZIP central directory entry is truncated", "unihex");
    }
    if (readUint32LE(bytes, centralOffset) !== centralDirectorySignature) {
      throw new InvalidProviderError("Invalid Unihex ZIP central directory structure", "unihex");
    }

    const flags = readUint16LE(bytes, centralOffset + 8);
    const compression = readUint16LE(bytes, centralOffset + 10);
    const expectedCrc = readUint32LE(bytes, centralOffset + 16);
    const compressedSize = readUint32LE(bytes, centralOffset + 20);
    const uncompressedSize = readUint32LE(bytes, centralOffset + 24);
    const nameLength = readUint16LE(bytes, centralOffset + 28);
    const extraLength = readUint16LE(bytes, centralOffset + 30);
    const commentSize = readUint16LE(bytes, centralOffset + 32);
    const localHeaderOffset = readUint32LE(bytes, centralOffset + 42);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new InvalidProviderError("ZIP64 Unihex entries are unsupported", "unihex");
    }
    const centralEntryEnd = centralOffset + 46 + nameLength + extraLength + commentSize;
    if (centralEntryEnd > centralDirectoryEnd) {
      throw new InvalidProviderError("Unihex ZIP central directory entry is truncated", "unihex");
    }
    if ((flags & 0x01) !== 0) {
      throw new InvalidProviderError("Encrypted Unihex ZIP entries are unsupported", "unihex");
    }
    if (compression !== 0 && compression !== 8) {
      throw new InvalidProviderError(
        `Unsupported Unihex ZIP compression method: ${compression}`,
        "unihex",
      );
    }

    const nameStart = centralOffset + 46;
    const name = decodeZipName(bytes.subarray(nameStart, nameStart + nameLength), flags);
    const localHeaderEnd = localHeaderOffset + 30;
    if (
      localHeaderOffset > bytes.length ||
      localHeaderEnd > bytes.length ||
      readUint32LE(bytes, localHeaderOffset) !== localFileSignature
    ) {
      throw new InvalidProviderError("Unihex ZIP local header is truncated or invalid", "unihex");
    }
    const localNameLength = readUint16LE(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(bytes, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart > bytes.length || dataEnd > bytes.length || dataEnd < dataStart) {
      throw new InvalidProviderError("Unihex ZIP entry is truncated", "unihex");
    }

    // The central directory is authoritative when bit 3 is set: the local
    // header may contain zero sizes and a data descriptor follows the data.
    const compressed = bytes.subarray(dataStart, dataEnd);
    let decoded: Uint8Array;
    try {
      decoded = compression === 0
        ? new Uint8Array(compressed)
        : new Uint8Array(inflateRawSync(compressed));
    } catch (error) {
      throw new InvalidProviderError(
        `Unable to decompress Unihex ZIP entry ${name}`,
        "unihex",
        name,
        undefined,
        error,
      );
    }
    if (decoded.length !== uncompressedSize || crc32(decoded) !== expectedCrc) {
      throw new InvalidProviderError(
        `Unihex ZIP entry ${name} failed size or CRC validation`,
        "unihex",
        name,
      );
    }
    if (!name.endsWith("/") && name.toLowerCase().endsWith(".hex")) {
      entries.push(decoded);
    }
    centralOffset = centralEntryEnd;
  }
  if (centralOffset !== centralDirectoryEnd) {
    throw new InvalidProviderError("Unihex ZIP central directory size is inconsistent", "unihex");
  }
  if (entries.length === 0) {
    throw new InvalidProviderError("Unihex ZIP contains no .hex entries", "unihex");
  }
  return entries;
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new InvalidProviderError("Unihex data is not valid UTF-8", "unihex", undefined, undefined, error);
  }
}

function parseHexText(text: string): ReadonlyMap<number, UnihexRecord> {
  const records = new Map<number, UnihexRecord>();
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new InvalidProviderError(`Invalid Unihex line ${lineIndex + 1}`, "unihex");
    }
    const codepointText = line.slice(0, separator);
    const payload = line.slice(separator + 1).trim();
    if (!/^[0-9a-f]+$/i.test(codepointText) || !/^[0-9a-f]+$/i.test(payload)) {
      throw new InvalidProviderError(`Invalid Unihex hexadecimal data on line ${lineIndex + 1}`, "unihex");
    }
    const codepoint = Number.parseInt(codepointText, 16);
    if (
      !Number.isInteger(codepoint) ||
      codepoint < 0 ||
      codepoint > 0x10ffff ||
      (codepoint >= 0xd800 && codepoint <= 0xdfff)
    ) {
      throw new InvalidProviderError(`Invalid Unihex codepoint on line ${lineIndex + 1}`, "unihex");
    }
    if (payload.length === 0 || payload.length % 16 !== 0) {
      throw new InvalidProviderError(
        `Unihex payload on line ${lineIndex + 1} must encode sixteen rows`,
        "unihex",
      );
    }
    const hexDigitsPerRow = payload.length / 16;
    const width = hexDigitsPerRow * 4;
    if (!Number.isInteger(hexDigitsPerRow) || width <= 0) {
      throw new InvalidProviderError(`Invalid Unihex width on line ${lineIndex + 1}`, "unihex");
    }
    const rows: Uint8Array[] = [];
    for (let rowIndex = 0; rowIndex < 16; rowIndex += 1) {
      const rowHex = payload.slice(rowIndex * hexDigitsPerRow, (rowIndex + 1) * hexDigitsPerRow);
      const bits = new Uint8Array(width);
      for (let bitIndex = 0; bitIndex < width; bitIndex += 1) {
        const hexIndex = Math.floor(bitIndex / 4);
        const bitInHex = 3 - (bitIndex % 4);
        const digit = Number.parseInt(rowHex[hexIndex] ?? "0", 16);
        bits[bitIndex] = (digit & (1 << bitInHex)) !== 0 ? 1 : 0;
      }
      rows.push(bits);
    }
    if (records.has(codepoint)) {
      throw new InvalidProviderError(
        `Duplicate Unihex codepoint U+${codepoint.toString(16).toUpperCase()}`,
        "unihex",
      );
    }
    records.set(codepoint, { codepoint, width, rows });
  }
  return records;
}

function overrideFor(
  overrides: readonly UnihexSizeOverride[],
  codepoint: number,
): UnihexSizeOverride | undefined {
  return overrides.find((override) => codepoint >= override.from && codepoint <= override.to);
}

/** Reads plain GNU Unihex text or the ZIP container used by vanilla assets. */
export class UnihexGlyphProvider implements GlyphProvider {
  readonly type = "unihex" as const;
  private readonly definition: UnihexProviderDefinition;
  private readonly context: ProviderContext;
  private recordsPromise?: Promise<ReadonlyMap<number, UnihexRecord>>;

  constructor(definition: UnihexProviderDefinition, context: ProviderContext) {
    this.definition = definition;
    this.context = context;
  }

  private async loadRecords(): Promise<ReadonlyMap<number, UnihexRecord>> {
    const bytes = await readAssetBytes(this.context.store, this.context.version, this.definition.hexFile);
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
    if (isZip) {
      const entries = decodeZipEntries(bytes);
      const text = entries
        .map((entry) => decodeText(entry))
        .join("\n");
      return parseHexText(text);
    }
    return parseHexText(decodeText(bytes));
  }

  private getRecords(): Promise<ReadonlyMap<number, UnihexRecord>> {
    this.recordsPromise ??= this.loadRecords();
    return this.recordsPromise;
  }

  async resolve(codepoint: number): Promise<MinecraftGlyph | undefined> {
    assertUnicodeScalar(codepoint);
    const records = await this.getRecords();
    const record = records.get(codepoint);
    if (record === undefined) return undefined;

    const override = overrideFor(this.definition.sizeOverrides, codepoint);
    let leftMargin = 0;
    let rightMargin = 0;
    if (override !== undefined) {
      if (override.right >= override.left && override.right >= Math.floor(record.width / 2)) {
        leftMargin = override.left;
        rightMargin = Math.max(0, record.width - 1 - override.right);
      } else {
        leftMargin = override.left;
        rightMargin = override.right;
      }
    }
    const targetHeight = this.definition.height ?? 8;
    const logicalScale = this.definition.resolution ?? (targetHeight / 16);
    const sourceHeight = logicalScale * 16;
    const sourceAscent = this.definition.ascent ?? sourceHeight;
    if (record.width < leftMargin + rightMargin) {
      throw new InvalidProviderError(
        `Unihex bearings exceed glyph width for U+${codepoint.toString(16).toUpperCase()}`,
        this.type,
        this.definition.hexFile,
        codepoint,
      );
    }

    const pw = minecraftToFontUnits(logicalScale, this.context.scale);
    const ph = minecraftToFontUnits(logicalScale, this.context.scale);
    const ox = minecraftToFontUnits(
      -leftMargin * logicalScale + (this.definition.bearingLeft ?? 0),
      this.context.scale,
    );
    const oy = minecraftRelativeYToOpenTypeY(
      16 * logicalScale,
      sourceAscent,
      this.context.scale,
    );

    const contours = vectorizeBitmapAsCoreContours(
      record.rows.map((row) => Array.from(row)),
      {
        pixelWidth: pw,
        pixelHeight: ph,
        originX: ox,
        originY: oy,
        rowOrder: "top-to-bottom",
      },
    );

    const defaultAdvance = Math.max(0, (record.width - leftMargin - rightMargin) * logicalScale);
    const metrics = {
      advance: lookupProviderNumber(this.definition, codepoint, "advance", defaultAdvance),
      boldOffset: lookupProviderNumber(this.definition, codepoint, "boldOffset", 1),
      bearingLeft: lookupProviderNumber(this.definition, codepoint, "bearingLeft", leftMargin),
      bearingTop: lookupProviderNumber(this.definition, codepoint, "bearingTop", sourceAscent),
    };
    return createProviderGlyph(codepoint, contours, metrics, this.context, this.type);
  }

  /** Source cell size in logical Minecraft pixels for diagnostics/tests. */
  async getResolution(codepoint?: number): Promise<number | undefined> {
    if (codepoint !== undefined) {
      assertUnicodeScalar(codepoint);
      const records = await this.getRecords();
      const record = records.get(codepoint);
      if (record === undefined) return undefined;
      return record.width;
    }
    const records = await this.getRecords();
    const first = records.values().next().value as UnihexRecord | undefined;
    return first?.width;
  }
}
