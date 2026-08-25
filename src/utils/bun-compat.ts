import { dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";

declare const globalThis: {
  Bun?: {
    file: (path: string) => { write: (data: Uint8Array | ArrayBuffer) => Promise<number> };
    deflateSync: (data: Uint8Array) => Uint8Array;
    inflateSync: (data: Uint8Array) => Uint8Array;
  };
};

/**
 * Fast file writing using Bun.file().write() when running under Bun (kernel DMA I/O),
 * with automatic fallback to node:fs/promises.writeFile under Node.js.
 */
export async function fastWriteFile(path: string, data: Uint8Array): Promise<void> {
  if (typeof globalThis.Bun !== "undefined" && typeof globalThis.Bun.file === "function") {
    await globalThis.Bun.file(path).write(data);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

/**
 * SIMD-accelerated zlib compression using Bun.deflateSync when available,
 * with automatic fallback to node:zlib.deflateSync under Node.js.
 */
export function fastDeflateSync(data: Uint8Array): Uint8Array {
  if (typeof globalThis.Bun !== "undefined" && typeof globalThis.Bun.deflateSync === "function") {
    try {
      return globalThis.Bun.deflateSync(data);
    } catch {
      // Fallback on error
    }
  }
  return new Uint8Array(deflateSync(data));
}

/**
 * SIMD-accelerated zlib decompression using Bun.inflateSync when available,
 * with automatic fallback to node:zlib.inflateSync under Node.js.
 */
export function fastInflateSync(data: Uint8Array): Uint8Array {
  if (typeof globalThis.Bun !== "undefined" && typeof globalThis.Bun.inflateSync === "function") {
    try {
      return globalThis.Bun.inflateSync(data);
    } catch {
      // Fallback on error
    }
  }
  return new Uint8Array(inflateSync(data));
}
