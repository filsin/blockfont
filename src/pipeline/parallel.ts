import { existsSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { FontStyle, MinecraftGlyph } from "../core";
import { styleGlyphs, type StyledGlyph } from "../styles/variants";


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
): Promise<readonly StyledGlyph[]> {
  const total = glyphs.length;
  if (total < 100) {
    const result = styleGlyphs(glyphs, style);
    onProgress?.(total, total);
    return result;
  }

  const concurrency = Math.min(16, getConcurrency());
  const chunkSize = Math.ceil(total / concurrency);

  const chunks: MinecraftGlyph[][] = [];
  for (let i = 0; i < total; i += chunkSize) {
    chunks.push(glyphs.slice(i, i + chunkSize));
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

  const reportProgress = () => {
    const sum = chunkProgress.reduce((acc, val) => acc + val, 0);
    onProgress?.(sum, total);
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


  return Object.freeze(results.flat());
}
