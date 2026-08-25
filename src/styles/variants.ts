import {
  asIntegerFontUnit,
  type FontStyle,
} from "../core/index";
import type { GlyphMetrics, MinecraftGlyph } from "../core/index";
import {
  getExactContoursBounds,
  type GeometryBounds,
} from "../geometry/bounds";
import { vectorizeBitmap } from "../geometry/vectorize";
import {
  toGeometryContours,
  type GeometryPoint,
  type GeometryContour,
  type GeometryContourInput,
} from "../geometry/types";
import {
  DEFAULT_ITALIC_SHEAR,
  shearContours,
  translateContours,
} from "./transform";

export interface StyledGlyph {
  readonly codepoint: number;
  readonly contours: readonly GeometryContour[];
  readonly bounds: GeometryBounds | undefined;
  readonly metrics: GlyphMetrics;
  readonly fillRule: "nonzero";
  readonly coordinateSystem: MinecraftGlyph["coordinateSystem"];
  readonly style: FontStyle;
}

function cloneMetrics(metrics: GlyphMetrics, advance = metrics.advance): GlyphMetrics {
  return Object.freeze({
    advance: asIntegerFontUnit(advance, "Styled glyph advance"),
    boldOffset: metrics.boldOffset,
    bearingLeft: metrics.bearingLeft,
    bearingTop: metrics.bearingTop,
  });
}

function deduplicateExactContours(contours: readonly GeometryContour[]): readonly GeometryContour[] {
  const seen = new Set<string>();
  const result: GeometryContour[] = [];
  for (const contour of contours) {
    const signature = JSON.stringify(contour);
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(contour);
  }
  return Object.freeze(result);
}

function contourVertices(contour: GeometryContour): readonly GeometryPoint[] {
  return [
    contour.start,
    ...contour.segments.map((segment) => segment.to),
  ];
}

function isOrthogonalContour(contour: GeometryContour): boolean {
  if (!contour.closed) return false;
  let previous = contour.start;
  for (const segment of contour.segments) {
    if (segment.type !== "line") return false;
    if (previous.x !== segment.to.x && previous.y !== segment.to.y) return false;
    previous = segment.to;
  }
  return previous.x === contour.start.x || previous.y === contour.start.y;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function gridStep(contours: readonly GeometryContour[], boldOffset: number): number | undefined {
  const xValues: number[] = [];
  const yValues: number[] = [];
  for (const contour of contours) {
    for (const point of contourVertices(contour)) {
      if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) return undefined;
      xValues.push(point.x);
      yValues.push(point.y);
    }
  }
  if (!Number.isSafeInteger(boldOffset)) return undefined;
  let result = Math.abs(boldOffset);
  for (const values of [xValues, yValues]) {
    const minimum = Math.min(...values);
    for (const value of values) result = gcd(result, value - minimum);
  }
  return result > 0 ? result : 1;
}

function nonZeroContains(x: number, y: number, contours: readonly GeometryContour[]): boolean {
  let winding = 0;
  for (const contour of contours) {
    const vertices = contourVertices(contour);
    for (let index = 0; index < vertices.length; index += 1) {
      const from = vertices[index]!;
      const to = vertices[(index + 1) % vertices.length]!;
      const cross = (to.x - from.x) * (y - from.y) - (x - from.x) * (to.y - from.y);
      if (from.y <= y) {
        if (to.y > y && cross > 0) winding += 1;
      } else if (to.y <= y && cross < 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}

/**
 * Performs a boolean union for grid-aligned orthogonal contours by sampling
 * the exact source cells and vectorizing the union again.  This is exact for
 * bitmap geometry and preserves holes through the non-zero winding test.
 */
function unionOrthogonalContours(
  original: readonly GeometryContour[],
  translated: readonly GeometryContour[],
  boldOffset: number,
): readonly GeometryContour[] | undefined {
  const all = [...original, ...translated];
  if (!all.every(isOrthogonalContour)) return undefined;
  const step = gridStep(all, boldOffset);
  const bounds = getExactContoursBounds(all);
  if (step === undefined || bounds === undefined) return undefined;
  if (![bounds.xMin, bounds.yMin, bounds.xMax, bounds.yMax].every(Number.isSafeInteger)) return undefined;
  const width = (bounds.xMax - bounds.xMin) / step;
  const height = (bounds.yMax - bounds.yMin) / step;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return undefined;
  // Avoid turning malformed/unbounded input into an unreasonably large grid.
  if (width * height > 8_000_000) return undefined;

  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const centerY = bounds.yMin + (y + 0.5) * step;
    for (let x = 0; x < width; x += 1) {
      const centerX = bounds.xMin + (x + 0.5) * step;
      if (nonZeroContains(centerX, centerY, original) || nonZeroContains(centerX, centerY, translated)) {
        data[y * width + x] = 1;
      }
    }
  }

  return vectorizeBitmap(
    { width, height, data },
    {
      pixelWidth: step,
      pixelHeight: step,
      originX: bounds.xMin,
      originY: bounds.yMin,
      rowOrder: "bottom-to-top",
    },
  );
}


/**
 * Builds the Bold outline as two non-stroked outlines. Keeping both windings
 * means holes remain holes under OpenType's non-zero fill rule; exact duplicate
 * outlines are removed when boldOffset is zero.
 */
export function boldContours(
  contours: readonly (GeometryContourInput)[],
  boldOffset: number,
): readonly GeometryContour[] {
  if (!Number.isFinite(boldOffset)) throw new RangeError("boldOffset must be finite");
  const original = toGeometryContours(contours);
  const translated = translateContours(original, boldOffset);
  // Curves are deliberately kept as two untouched outlines.  TrueType/CFF
  // boolean clipping of arbitrary quadratic/cubic paths is not available in
  // the dependency; overlaying the source geometry never invents an
  // intersection curve. Bitmap/orthogonal contours take the exact union path.
  return unionOrthogonalContours(original, translated, boldOffset)
    ?? deduplicateExactContours([...original, ...translated]);
}

export function regularContours(
  contours: readonly GeometryContourInput[],
): readonly GeometryContour[] {
  return toGeometryContours(contours);
}

export function italicContours(
  contours: readonly GeometryContourInput[],
  shear = DEFAULT_ITALIC_SHEAR,
): readonly GeometryContour[] {
  return shearContours(toGeometryContours(contours), shear);
}

export function boldItalicContours(
  contours: readonly GeometryContourInput[],
  boldOffset: number,
  shear = DEFAULT_ITALIC_SHEAR,
): readonly GeometryContour[] {
  return shearContours(boldContours(contours, boldOffset), shear);
}

function makeStyledGlyph(
  glyph: MinecraftGlyph,
  style: FontStyle,
  contours: readonly GeometryContour[],
  advance = glyph.metrics.advance,
): StyledGlyph {
  const frozenContours = Object.freeze([...contours]);
  return Object.freeze({
    codepoint: glyph.codepoint,
    contours: frozenContours,
    bounds: getExactContoursBounds(frozenContours),
    metrics: cloneMetrics(glyph.metrics, advance),
    fillRule: glyph.fillRule,
    coordinateSystem: glyph.coordinateSystem,
    style,
  });
}

export function regularGlyph(glyph: MinecraftGlyph): StyledGlyph {
  return makeStyledGlyph(glyph, "regular", regularContours(glyph.contours));
}

export function boldGlyph(glyph: MinecraftGlyph): StyledGlyph {
  return makeStyledGlyph(
    glyph,
    "bold",
    boldContours(glyph.contours, glyph.metrics.boldOffset),
    asIntegerFontUnit(
      glyph.metrics.advance + glyph.metrics.boldOffset,
      "Bold glyph advance",
    ),
  );
}

export function italicGlyph(glyph: MinecraftGlyph): StyledGlyph {
  return makeStyledGlyph(glyph, "italic", italicContours(glyph.contours));
}

export function boldItalicGlyph(glyph: MinecraftGlyph): StyledGlyph {
  return makeStyledGlyph(
    glyph,
    "boldItalic",
    boldItalicContours(glyph.contours, glyph.metrics.boldOffset),
    asIntegerFontUnit(
      glyph.metrics.advance + glyph.metrics.boldOffset,
      "Bold Italic glyph advance",
    ),
  );
}

export function styleGlyph(glyph: MinecraftGlyph, style: FontStyle): StyledGlyph {
  switch (style) {
    case "regular": return regularGlyph(glyph);
    case "bold": return boldGlyph(glyph);
    case "italic": return italicGlyph(glyph);
    case "boldItalic": return boldItalicGlyph(glyph);
  }
}


export function styleGlyphs(
  glyphs: readonly MinecraftGlyph[],
  style: FontStyle,
): readonly StyledGlyph[] {
  return Object.freeze(glyphs.map((glyph) => styleGlyph(glyph, style)));
}

export const applyStyle = styleGlyph;
export const applyBold = boldGlyph;
export const applyItalic = italicGlyph;
export const applyBoldItalic = boldItalicGlyph;
