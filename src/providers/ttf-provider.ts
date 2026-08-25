import { parse, type Font, type Glyph, type PathCommand } from "opentype.js";

import {
  createPathContour,
  type Contour,
  type MinecraftGlyph,
  type PointInput,
  type PathSegmentInput,
  type Winding,
} from "../core";
import { readAssetBytes } from "../assets";
import { InvalidProviderError } from "./errors";
import type { TtfProviderDefinition } from "./font-definition";
import {
  assertUnicodeScalar,
  createProviderGlyph,
  ensureIntegerCoordinate,
  lookupProviderNumber,
  readSkipCodepoints,
  type GlyphProvider,
  type ProviderContext,
} from "./provider-utils";

interface TtfContourBuilder {
  readonly start: PointInput;
  readonly segments: PathSegmentInput[];
  readonly endpoints: PointInput[];
  closed: boolean;
}

function sourceToMinecraft(value: number, font: Font, size: number, shift: number): number {
  return (value * size) / font.unitsPerEm + shift;
}

function commandPoint(
  x: number,
  y: number,
  font: Font,
  size: number,
  shiftX: number,
  shiftY: number,
  fontUnitsPerMinecraftPixel: number,
  rounding: "reject" | "round",
  label: string,
): PointInput {
  const xInMinecraft = sourceToMinecraft(x, font, size, shiftX);
  const yInMinecraft = sourceToMinecraft(y, font, size, shiftY);
  return {
    x: ensureIntegerCoordinate(
      xInMinecraft * fontUnitsPerMinecraftPixel,
      `${label}.x`,
      rounding,
    ),
    y: ensureIntegerCoordinate(
      yInMinecraft * fontUnitsPerMinecraftPixel,
      `${label}.y`,
      rounding,
    ),
  };
}

function appendCommand(
  builder: TtfContourBuilder,
  command: Exclude<PathCommand, { type: "M" } | { type: "Z" }>,
  font: Font,
  size: number,
  shiftX: number,
  shiftY: number,
  fontUnitsPerMinecraftPixel: number,
  rounding: "reject" | "round",
  index: number,
): void {
  switch (command.type) {
    case "L":
      builder.segments.push({
        type: "line",
        to: commandPoint(command.x, command.y, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}]`),
      });
      builder.endpoints.push(
        commandPoint(command.x, command.y, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}]`),
      );
      break;
    case "Q":
      builder.segments.push({
        type: "quadratic",
        control: commandPoint(command.x1, command.y1, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}].control`),
        to: commandPoint(command.x, command.y, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}]`),
      });
      builder.endpoints.push(
        commandPoint(command.x, command.y, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}]`),
      );
      break;
    case "C":
      builder.segments.push({
        type: "cubic",
        control1: commandPoint(command.x1, command.y1, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}].control1`),
        control2: commandPoint(command.x2, command.y2, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}].control2`),
        to: commandPoint(command.x, command.y, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}]`),
      });
      builder.endpoints.push(
        commandPoint(command.x, command.y, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}]`),
      );
      break;
  }
}

function contourWinding(builder: TtfContourBuilder): Winding {
  if (builder.endpoints.length < 2) return "counterclockwise";
  const points = [builder.start, ...builder.endpoints];
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    area += current.x * next.y - next.x * current.y;
  }
  return area < 0 ? "clockwise" : "counterclockwise";
}

function pathToContours(
  glyph: Glyph,
  font: Font,
  size: number,
  shiftX: number,
  shiftY: number,
  fontUnitsPerMinecraftPixel: number,
  rounding: "reject" | "round",
): readonly Contour[] {
  const builders: TtfContourBuilder[] = [];
  let current: TtfContourBuilder | undefined;
  for (const [index, command] of glyph.path.commands.entries()) {
    if (command.type === "M") {
      if (current !== undefined) {
        if (!current.closed) {
          throw new InvalidProviderError("TTF glyph contains an open contour", "ttf");
        }
        builders.push(current);
      }
      const start = commandPoint(command.x, command.y, font, size, shiftX, shiftY, fontUnitsPerMinecraftPixel, rounding, `command[${index}]`);
      current = { start, segments: [], endpoints: [], closed: false };
      continue;
    }
    if (current === undefined) {
      if (command.type === "Z") continue;
      throw new InvalidProviderError("TTF glyph path starts without a move command", "ttf");
    }
    if (command.type === "Z") {
      current.closed = true;
      continue;
    }
    appendCommand(
      current,
      command,
      font,
      size,
      shiftX,
      shiftY,
      fontUnitsPerMinecraftPixel,
      rounding,
      index,
    );
  }
  if (current !== undefined) {
    if (!current.closed) {
      throw new InvalidProviderError("TTF glyph contains an open contour", "ttf");
    }
    builders.push(current);
  }

  return builders.map((builder) => createPathContour({
    start: builder.start,
    segments: builder.segments,
    closed: true,
    winding: contourWinding(builder),
  }));
}

/**
 * Reads TTF/OTF providers asynchronously and keeps opentype.js curves rather
 * than flattening them into bitmap rectangles.
 */
export class TtfGlyphProvider implements GlyphProvider {
  readonly type = "ttf" as const;
  private readonly definition: TtfProviderDefinition;
  private readonly context: ProviderContext;
  private fontPromise?: Promise<Font>;

  constructor(definition: TtfProviderDefinition, context: ProviderContext) {
    this.definition = definition;
    this.context = context;
  }

  private async loadFont(): Promise<Font> {
    const bytes = await readAssetBytes(this.context.store, this.context.version, this.definition.file);
    try {
      return parse(new Uint8Array(bytes).buffer);
    } catch (error) {
      throw new InvalidProviderError(
        `Unable to parse TTF/OTF provider: ${this.definition.file}`,
        this.type,
        this.definition.file,
        undefined,
        error,
      );
    }
  }

  private getFont(): Promise<Font> {
    this.fontPromise ??= this.loadFont();
    return this.fontPromise;
  }

  async resolve(codepoint: number): Promise<MinecraftGlyph | undefined> {
    assertUnicodeScalar(codepoint);
    const skip = readSkipCodepoints(this.definition.skip);
    if (skip.has(codepoint)) return undefined;

    const font = await this.getFont();
    const character = String.fromCodePoint(codepoint);
    if (!font.hasChar(character)) return undefined;
    const glyph = font.charToGlyph(character);
    if (glyph === undefined || glyph.path === undefined) {
      throw new InvalidProviderError(
        `TTF provider returned no glyph path for U+${codepoint.toString(16).toUpperCase()}`,
        this.type,
        this.definition.file,
        codepoint,
      );
    }
    if (!glyph.unicodes.includes(codepoint)) return undefined;

    const size = this.definition.size ?? 16;
    const shiftX = this.definition.shift?.[0] ?? 0;
    const shiftY = this.definition.shift?.[1] ?? 0;
    // Reject is the safe default: omitting the policy must never discard
    // fractional TTF coordinates. "round" is deterministic and explicit.
    const rounding = this.definition.coordinateRounding ?? "reject";
    let contours: readonly Contour[];
    try {
      contours = pathToContours(
        glyph,
        font,
        size,
        shiftX,
        shiftY,
        this.context.scale.fontUnitsPerMinecraftPixel,
        rounding,
      );
    } catch (error) {
      if (error instanceof InvalidProviderError) throw error;
      throw new InvalidProviderError(
        `Unable to convert TTF curves for U+${codepoint.toString(16).toUpperCase()}`,
        this.type,
        this.definition.file,
        codepoint,
        error,
      );
    }

    const glyphMetrics = glyph.getMetrics();
    const sourceScale = size / font.unitsPerEm;
    const defaultAdvance = (glyph.advanceWidth ?? 0) * sourceScale;
    const defaultBearingLeft = (glyphMetrics.leftSideBearing ?? glyph.xMin ?? 0) * sourceScale;
    const defaultBearingTop = (glyph.yMax ?? 0) * sourceScale + shiftY;
    return createProviderGlyph(
      codepoint,
      contours,
      {
        advance: lookupProviderNumber(this.definition, codepoint, "advance", defaultAdvance),
        boldOffset: lookupProviderNumber(this.definition, codepoint, "boldOffset", 1),
        bearingLeft: lookupProviderNumber(this.definition, codepoint, "bearingLeft", defaultBearingLeft),
        bearingTop: lookupProviderNumber(this.definition, codepoint, "bearingTop", defaultBearingTop),
      },
      this.context,
      this.type,
      rounding,
    );
  }
}
