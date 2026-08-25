import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FontStyle } from "../core";
import type { StyledGlyph } from "../styles/variants";

export interface CacheKeyOptions {
  readonly codepoint: number;
  readonly style: FontStyle;
  readonly unitsPerEm?: number | undefined;
}

export function computeGlyphCacheKey(options: CacheKeyOptions): string {
  const upm = options.unitsPerEm ?? 2048;
  return `${options.codepoint}_${options.style}_${upm}`;
}

export class GlyphCacheManager {
  private static instance?: GlyphCacheManager;
  private readonly memoryCache = new Map<string, StyledGlyph>();
  private readonly cacheDir: string;
  private readonly cacheFilePath: string;
  private loadedFromDisk = false;

  public constructor(cacheDir = resolve(process.cwd(), ".cache", "blockfont")) {
    this.cacheDir = cacheDir;
    this.cacheFilePath = join(cacheDir, "glyph_vectors.json");
  }

  public static getInstance(): GlyphCacheManager {
    GlyphCacheManager.instance ??= new GlyphCacheManager();
    return GlyphCacheManager.instance;
  }

  public get(key: string): StyledGlyph | undefined {
    if (!this.loadedFromDisk) {
      this.loadFromDisk();
    }
    return this.memoryCache.get(key);
  }

  public set(key: string, glyph: StyledGlyph): void {
    this.memoryCache.set(key, glyph);
  }

  public setMany(entries: ReadonlyArray<readonly [string, StyledGlyph]>): void {
    for (const [key, glyph] of entries) {
      this.memoryCache.set(key, glyph);
    }
  }

  public loadFromDisk(): void {
    if (this.loadedFromDisk) return;
    this.loadedFromDisk = true;
    try {
      if (existsSync(this.cacheFilePath)) {
        const raw = readFileSync(this.cacheFilePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, StyledGlyph>;
        for (const [key, glyph] of Object.entries(parsed)) {
          this.memoryCache.set(key, glyph);
        }
      }
    } catch {
      // Non-fatal if cache file is unreadable or malformed
    }
  }

  public saveToDisk(): void {
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
      const serializable: Record<string, StyledGlyph> = {};
      for (const [key, glyph] of this.memoryCache.entries()) {
        serializable[key] = glyph;
      }
      writeFileSync(this.cacheFilePath, JSON.stringify(serializable), "utf-8");
    } catch {
      // Non-fatal if cache writing fails
    }
  }

  public clear(): void {
    this.memoryCache.clear();
    this.loadedFromDisk = true;
  }
}
