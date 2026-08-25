import { createPathContour, type Contour } from "../core/contour";
import { asIntegerFontUnit } from "../core/units";
import { geometryPoint, type GeometryContour } from "./types";

export type BitmapCell = boolean | number;
export type BitmapRows = readonly (readonly BitmapCell[])[];

export interface BitmapData {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<BitmapCell>;
}

export type BitmapInput = BitmapRows | BitmapData;

export interface BitmapVectorizationOptions {
  /** Width of one source cell in normalized font units. */
  readonly pixelWidth?: number;
  /** Height of one source cell in normalized font units. */
  readonly pixelHeight?: number;
  readonly originX?: number;
  readonly originY?: number;
  /** Bitmap row 0 is bottom-most by default; use this for PNG-style rows. */
  readonly rowOrder?: "bottom-to-top" | "top-to-bottom";
}

interface GridPoint {
  readonly x: number;
  readonly y: number;
}

interface BoundaryEdge {
  readonly id: string;
  readonly start: GridPoint;
  readonly end: GridPoint;
  readonly owner: string;
}

function isActive(cell: BitmapCell | undefined): boolean {
  return cell === true || (typeof cell === "number" && cell !== 0);
}

function validatePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
  return value;
}

function validateRows(bitmap: BitmapRows): { width: number; height: number; get: (x: number, y: number) => BitmapCell | undefined } {
  const height = bitmap.length;
  const width = bitmap[0]?.length ?? 0;
  for (const row of bitmap) {
    if (row.length !== width) throw new RangeError("Bitmap rows must have a uniform width");
  }
  return { width, height, get: (x, y) => bitmap[y]?.[x] };
}

function normalizeBitmap(bitmap: BitmapInput): {
  width: number;
  height: number;
  get: (x: number, y: number) => BitmapCell | undefined;
} {
  if (Array.isArray(bitmap)) return validateRows(bitmap as BitmapRows);
  const data = bitmap as BitmapData;
  if (!Number.isSafeInteger(data.width) || data.width < 0) {
    throw new RangeError("Bitmap width must be a non-negative integer");
  }
  if (!Number.isSafeInteger(data.height) || data.height < 0) {
    throw new RangeError("Bitmap height must be a non-negative integer");
  }
  if (data.data.length < data.width * data.height) {
    throw new RangeError("Bitmap data is shorter than width × height");
  }
  return {
    width: data.width,
    height: data.height,
    get: (x, y) => data.data[y * data.width + x],
  };
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function edgeKey(start: GridPoint, end: GridPoint): string {
  return `${pointKey(start)}>${pointKey(end)}`;
}

function reverseEdgeKey(start: GridPoint, end: GridPoint): string {
  return edgeKey(end, start);
}

function addBoundaryEdge(
  edges: Map<string, BoundaryEdge>,
  start: GridPoint,
  end: GridPoint,
  owner: string,
): void {
  const key = edgeKey(start, end);
  const reverse = reverseEdgeKey(start, end);
  if (edges.has(reverse)) {
    edges.delete(reverse);
    return;
  }
  edges.set(key, { id: key, start, end, owner });
}

function chooseNextEdge(
  incoming: BoundaryEdge,
  candidates: readonly BoundaryEdge[],
): BoundaryEdge | undefined {
  const sameOwner = candidates.find((candidate) => candidate.owner === incoming.owner);
  if (sameOwner !== undefined) return sameOwner;
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  // A valid binary-cell boundary only has degree four at a diagonal-touch
  // vertex. The same-owner pairing above must resolve both loops there; any
  // remaining ambiguity indicates malformed topology rather than something
  // that an angle heuristic can repair safely.
  throw new Error(`Ambiguous bitmap boundary at ${pointKey(incoming.end)}`);
}

function coordinates(
  point: GridPoint,
  originX: number,
  originY: number,
  pixelWidth: number,
  pixelHeight: number,
): { x: number; y: number } {
  return {
    x: originX + point.x * pixelWidth,
    y: originY + point.y * pixelHeight,
  };
}

function polygonArea(points: readonly GridPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function simplifyGridLoop(points: readonly GridPoint[]): GridPoint[] {
  const result = points.slice();
  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index + result.length - 1) % result.length]!;
      const current = result[index]!;
      const next = result[(index + 1) % result.length]!;
      const incomingX = current.x - previous.x;
      const incomingY = current.y - previous.y;
      const outgoingX = next.x - current.x;
      const outgoingY = next.y - current.y;
      if (incomingX * outgoingY - incomingY * outgoingX === 0
        && (incomingX * outgoingX + incomingY * outgoingY) >= 0) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function traceLoops(edges: readonly BoundaryEdge[]): GridPoint[][] {
  const outgoing = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(pointKey(edge.start)) ?? [];
    list.push(edge);
    outgoing.set(pointKey(edge.start), list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const unused = new Set(edges.map((edge) => edge.id));
  const loops: GridPoint[][] = [];
  while (unused.size > 0) {
    const firstId = [...unused].sort()[0]!;
    let current = edges.find((edge) => edge.id === firstId)!;
    const start = current.start;
    const points: GridPoint[] = [start];
    let guard = 0;
    while (guard <= edges.length + 1) {
      guard += 1;
      unused.delete(current.id);
      points.push(current.end);
      if (current.end.x === start.x && current.end.y === start.y) break;
      const candidates = (outgoing.get(pointKey(current.end)) ?? [])
        .filter((edge) => unused.has(edge.id));
      const next = chooseNextEdge(current, candidates);
      if (next === undefined) {
        throw new Error("Bitmap boundary did not form a closed contour");
      }
      current = next;
    }
    if (points.length > 1
      && points[points.length - 1]!.x === start.x
      && points[points.length - 1]!.y === start.y) {
      points.pop();
    }
    const simplified = simplifyGridLoop(points);
    if (simplified.length >= 3) loops.push(simplified);
    else throw new Error("Bitmap boundary produced a degenerate contour");
  }
  return loops;
}

/**
 * Converts a binary bitmap to one orthogonal contour per boundary loop.
 * Adjacent cell edges are cancelled before tracing, so the source grid is
 * preserved without emitting a rectangle for every active pixel.
 */
export function vectorizeBitmap(
  bitmap: BitmapInput,
  options: BitmapVectorizationOptions = {},
): readonly GeometryContour[] {
  const normalized = normalizeBitmap(bitmap);
  const pixelWidth = validatePositive(options.pixelWidth ?? 1, "pixelWidth");
  const pixelHeight = validatePositive(options.pixelHeight ?? 1, "pixelHeight");
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
    throw new RangeError("Bitmap origin must be finite");
  }
  const rowOrder = options.rowOrder ?? "bottom-to-top";
  const edges = new Map<string, BoundaryEdge>();

  for (let row = 0; row < normalized.height; row += 1) {
    const y = rowOrder === "bottom-to-top" ? row : normalized.height - row - 1;
    for (let x = 0; x < normalized.width; x += 1) {
      if (!isActive(normalized.get(x, row))) continue;
      const owner = `${x},${y}`;
      const bottomLeft = { x, y };
      const bottomRight = { x: x + 1, y };
      const topRight = { x: x + 1, y: y + 1 };
      const topLeft = { x, y: y + 1 };
      addBoundaryEdge(edges, bottomLeft, bottomRight, owner);
      addBoundaryEdge(edges, bottomRight, topRight, owner);
      addBoundaryEdge(edges, topRight, topLeft, owner);
      addBoundaryEdge(edges, topLeft, bottomLeft, owner);
    }
  }

  const loops = traceLoops([...edges.values()]);
  return Object.freeze(loops.map((loop) => {
    const points = loop.map((point) => {
      const coordinate = coordinates(point, originX, originY, pixelWidth, pixelHeight);
      return geometryPoint(coordinate.x, coordinate.y);
    });
    const segments = points.slice(1).map((point) =>
      Object.freeze({ type: "line", to: point } as const),
    );
    return Object.freeze({
      start: points[0]!,
      segments: Object.freeze(segments),
      closed: true,
      winding: polygonArea(loop) < 0 ? "clockwise" as const : "counterclockwise" as const,
    });
  }));
}

/** Converts vectorized output to the integer-safe core contour model. */
export function vectorizeBitmapAsCoreContours(
  bitmap: BitmapInput,
  options: BitmapVectorizationOptions = {},
): readonly Contour[] {
  return Object.freeze(vectorizeBitmap(bitmap, options).map((contour) =>
    createPathContour({
      start: {
        x: asIntegerFontUnit(contour.start.x, "Vectorized contour x"),
        y: asIntegerFontUnit(contour.start.y, "Vectorized contour y"),
      },
      segments: contour.segments.map((segment) => {
        if (segment.type !== "line") throw new Error("Bitmap vectorization emitted a non-line segment");
        return {
          type: "line" as const,
          to: {
            x: asIntegerFontUnit(segment.to.x, "Vectorized contour x"),
            y: asIntegerFontUnit(segment.to.y, "Vectorized contour y"),
          },
        };
      }),
      closed: contour.closed,
      winding: contour.winding,
    }),
  ));
}

export const bitmapToContours = vectorizeBitmap;
export const bitmapToCoreContours = vectorizeBitmapAsCoreContours;
