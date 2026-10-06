/**
 * "Improve prompt": send the panel's prompt (and a downscaled composite of the active
 * document, when it has pixels) to a prompt-assist provider (Ollama vision chat) and put
 * the rewritten prompt back into the panel. Never generates an image.
 */

import { compositeToRaster, isEffectivelyVisible } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { promptAssist } from "./client";
import { withoutDiffOverlays } from "./overlay";
import { encodePng } from "./png";
import { aiUi } from "./ui.svelte";
import type { ProviderId, ProviderInfo } from "./types";

/** Longest edge sent to the vision model (keeps the request small and fast). */
export const ASSIST_MAX_EDGE = 768;

/** Providers that can improve prompts, in list order. */
export function assistProviders(list: readonly ProviderInfo[] = aiUi.providers): ProviderInfo[] {
  return list.filter((p) => p.promptAssist);
}

export interface ImproveOptions {
  provider?: ProviderId | undefined;
  /** Default: the panel's prompt. */
  text?: string | undefined;
  /** Default true: attach the active document's composite when it has visible pixels. */
  withImage?: boolean | undefined;
}

/**
 * Rewrite the prompt. Resolves with the new text (also written to `aiUi.prompt`);
 * rejects with a `{ code, message }` from Rust or an `Error` when no assistant exists.
 */
export async function improvePrompt(opts: ImproveOptions = {}): Promise<string> {
  const provider = opts.provider ?? assistProviders()[0]?.id;
  if (!provider) throw new Error("Add an Ollama provider (Edit > AI Providers) to improve prompts.");
  const text = (opts.text ?? aiUi.prompt).trim();
  let image: Uint8Array | undefined;
  const open = docStore.active;
  if (opts.withImage !== false && open) {
    const doc = withoutDiffOverlays(open.doc);
    if (doc.layers.some((l) => l.kind === "raster" && isEffectivelyVisible(doc, l))) {
      let raster = compositeToRaster(doc);
      const edge = Math.max(raster.width, raster.height);
      if (edge > ASSIST_MAX_EDGE) {
        const s = ASSIST_MAX_EDGE / edge;
        raster = raster.resize(Math.max(1, Math.round(raster.width * s)), Math.max(1, Math.round(raster.height * s)), "bilinear");
      }
      image = await encodePng(raster);
    }
  }
  if (!text && !image) throw new Error("Type a prompt or open an image first.");
  const improved = await promptAssist(provider, text, image);
  aiUi.prompt = improved;
  return improved;
}
