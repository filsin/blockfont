import { existsSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { FontStyle, MinecraftGlyph } from "../core";
import { styleGlyphs, type StyledGlyph } from "../styles/variants";


import { computeGlyphCacheKey, GlyphCacheManager } from "./cache";

export function getConcurrency(): number {
  try {
    if (typeof availableParallelism === "function") {
      return Math.max(1, availableParallelism());
    }
    return Math.max(1, cpus().length);
  } catch {
    return 4;
  }
}

export async function parallelStyleGlyphs(
  glyphs: readonly MinecraftGlyph[],
  style: FontStyle,
  onProgress?: (processed: number, total: number) => void,
  unitsPerEm?: number,
): Promise<readonly StyledGlyph[]> {
  const total = glyphs.length;
  const cacheManager = GlyphCacheManager.getInstance();

  const resultMap = new Map<number, StyledGlyph>();
  const uncachedGlyphs: MinecraftGlyph[] = [];
  const uncachedIndices: number[] = [];

  for (let index = 0; index < total; index += 1) {
    const glyph = glyphs[index]!;
    const key = computeGlyphCacheKey({ codepoint: glyph.codepoint, style, unitsPerEm });
    const cached = cacheManager.get(key);
    if (cached !== undefined) {
      resultMap.set(index, cached);
    } else {
      uncachedGlyphs.push(glyph);
      uncachedIndices.push(index);
    }
  }

  if (uncachedGlyphs.length === 0) {
    onProgress?.(total, total);
    const cachedList: StyledGlyph[] = [];
    for (let index = 0; index < total; index += 1) {
      cachedList.push(resultMap.get(index)!);
    }
    return Object.freeze(cachedList);
  }

  const uncachedTotal = uncachedGlyphs.length;
  let newlyVectorized: readonly StyledGlyph[];

  if (uncachedTotal < 100) {
    newlyVectorized = styleGlyphs(uncachedGlyphs, style);
    onProgress?.(total, total);
  } else {
    const concurrency = Math.min(16, getConcurrency());
    const chunkSize = Math.ceil(uncachedTotal / concurrency);

    const chunks: MinecraftGlyph[][] = [];
    for (let i = 0; i < uncachedTotal; i += chunkSize) {
      chunks.push(uncachedGlyphs.slice(i, i + chunkSize));
    }

    let workerPath = resolve(__dirname, "worker");
    if (!existsSync(`${workerPath}.js`) && existsSync(resolve(__dirname, "../../dist/pipeline/worker.js"))) {
      workerPath = resolve(__dirname, "../../dist/pipeline/worker.js");
    }

    const workerModule = workerPath;
    const workerCode = `
      const { parentPort } = require("node:worker_threads");
      const { styleGlyphs } = require("${workerModule.replace(/\\/g, "\\\\")}");

      parentPort.on("message", (msg) => {
        try {
          const result = styleGlyphs(msg.glyphs, msg.style);
          parentPort.postMessage({ id: msg.id, result });
        } catch (err) {
          parentPort.postMessage({ id: msg.id, error: String(err) });
        }
      });
    `;

    const chunkProgress = new Array<number>(chunks.length).fill(0);
    const results = new Array<readonly StyledGlyph[]>(chunks.length);

    const cachedCount = total - uncachedTotal;
    const reportProgress = () => {
      const sum = chunkProgress.reduce((acc, val) => acc + val, 0);
      onProgress?.(cachedCount + sum, total);
    };

    await Promise.all(
      chunks.map((chunk, index) => {
        return new Promise<void>((resolvePromise, rejectPromise) => {
          let worker: Worker;
          try {
            worker = new Worker(workerCode, { eval: true });
          } catch {
            try {
              results[index] = styleGlyphs(chunk, style);
              chunkProgress[index] = chunk.length;
              reportProgress();
              resolvePromise();
            } catch (err) {
              rejectPromise(err);
            }
            return;
          }

          worker.on(
            "message",
            (msg: { id: number; done?: boolean; progress?: number; result?: StyledGlyph[]; error?: string }) => {
              if (msg.error) {
                worker.terminate();
                rejectPromise(new Error(msg.error));
              } else if (msg.progress !== undefined) {
                chunkProgress[index] = msg.progress;
                reportProgress();
              } else if (msg.done) {
                worker.terminate();
                results[index] = msg.result!;
                chunkProgress[index] = chunk.length;
                reportProgress();
                resolvePromise();
              }
            },
          );

          worker.on("error", (err) => {
            worker.terminate();
            rejectPromise(err);
          });

          worker.postMessage({ id: index, glyphs: chunk, style });
        });
      }),
    );

    newlyVectorized = Object.freeze(results.flat());
  }

  // Store newly vectorized glyphs into GlyphCacheManager
  const newCacheEntries: Array<readonly [string, StyledGlyph]> = [];
  for (let idx = 0; idx < newlyVectorized.length; idx += 1) {
    const styled = newlyVectorized[idx]!;
    const originalIndex = uncachedIndices[idx]!;
    resultMap.set(originalIndex, styled);
    const key = computeGlyphCacheKey({ codepoint: styled.codepoint, style, unitsPerEm });
    newCacheEntries.push([key, styled]);
  }
  cacheManager.setMany(newCacheEntries);
  cacheManager.saveToDisk();

  const finalResults: StyledGlyph[] = [];
  for (let index = 0; index < total; index += 1) {
    finalResults.push(resultMap.get(index)!);
  }

  return Object.freeze(finalResults);
}
