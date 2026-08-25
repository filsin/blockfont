import { parentPort } from "node:worker_threads";
import { styleGlyph, type StyledGlyph } from "../styles/variants";
import type { MinecraftGlyph, FontStyle } from "../core";

if (parentPort) {
  parentPort.on(
    "message",
    (message: { id: number; glyphs: MinecraftGlyph[]; style: FontStyle }) => {
      try {
        const { id, glyphs, style } = message;
        const result: StyledGlyph[] = [];
        for (let i = 0; i < glyphs.length; i += 1) {
          result.push(styleGlyph(glyphs[i]!, style));
          if ((i + 1) % 50 === 0 || i + 1 === glyphs.length) {
            parentPort!.postMessage({ id, progress: i + 1, totalChunk: glyphs.length });
          }
        }
        parentPort!.postMessage({ id, done: true, result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        parentPort!.postMessage({ id: message.id, error: errorMessage });
      }
    },
  );
}

