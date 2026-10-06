/**
 * Mode resolution and mask emulation geometry. Pure TypeScript — no Svelte, no IPC —
 * so every rule here is unit-tested (`tests/ai/modes.test.ts`).
 *
 * The three workflows (PLAN.md section 2.2):
 * - `generate`  prompt -> image, no document input.
 * - `mask`      the active selection is the mask; only selected pixels may change.
 * - `instruct`  the whole composite plus an instruction.
 *
 * Only OpenAI has a native pixel mask. For xAI / Gemini a mask edit is **emulated**:
 * crop the composite to the selection bbox (+ padding), run an instruct edit on the
 * crop, then keep only the pixels under the soft selection mask. The mirror of
 * `crates/pf-ai/src/mask.rs`, written against the engine's typed arrays.
 */

import { Raster, Rect, type Selection } from "$lib/engine";
import type { AiMode, Capabilities } from "./types";

export interface ModeContext {
  /** A document is open. */
  hasDoc: boolean;
  /** The document has at least one visible raster layer (something to edit). */
  hasPixels: boolean;
  /** `doc.selection.isEmpty`. */
  selectionEmpty: boolean;
  /** `doc.selection.isAll` — a full-canvas selection is an instruct edit, not a mask. */
  selectionIsAll: boolean;
  caps: Capabilities | null;
  /** User override from the panel / a command (`ai.generate` forces `generate`). */
  forced?: AiMode | undefined;
}

export interface ModeResolution {
  mode: AiMode;
  /** True when `mode === "mask"` but the provider lacks a native mask endpoint. */
  emulated: boolean;
  /** One short sentence for the badge tooltip. */
  reason: string;
}

/** Decide which workflow a run will use. */
export function resolveMode(ctx: ModeContext): ModeResolution {
  const caps = ctx.caps;
  const canInstruct = caps?.instructEdit ?? false;
  const canMask = caps?.maskEdit ?? false;

  if (ctx.forced === "generate") {
    return { mode: "generate", emulated: false, reason: "Generate was chosen explicitly." };
  }
  if (!ctx.hasDoc) {
    return { mode: "generate", emulated: false, reason: "No document is open; the result opens a new one." };
  }
  if (!ctx.hasPixels) {
    return { mode: "generate", emulated: false, reason: "The document has no visible pixels to edit." };
  }
  if (!canInstruct) {
    return { mode: "generate", emulated: false, reason: "This provider cannot edit images, only generate." };
  }

  const hasMaskSelection = !ctx.selectionEmpty && !ctx.selectionIsAll;
  if (ctx.forced === "instruct") {
    return { mode: "instruct", emulated: false, reason: "Instruct edit was chosen explicitly; the selection is ignored." };
  }
  if (ctx.forced === "mask" && !hasMaskSelection) {
    return {
      mode: "instruct",
      emulated: false,
      reason: ctx.selectionEmpty ? "Nothing is selected, so the whole image is edited." : "Everything is selected, so the whole image is edited.",
    };
  }
  if (hasMaskSelection) {
    if (canMask) {
      return { mode: "mask", emulated: false, reason: "The selection is sent as a native mask." };
    }
    return {
      mode: "mask",
      emulated: true,
      reason: "This provider has no pixel mask. Pixelforge sends the selected region as a crop and pastes the result back under the selection.",
    };
  }
  return {
    mode: "instruct",
    emulated: false,
    reason: ctx.selectionEmpty ? "Nothing is selected, so the whole image is edited." : "Everything is selected, so the whole image is edited.",
  };
}

// ---------------------------------------------------------------------------
// Emulation geometry
// ---------------------------------------------------------------------------

/** Padding around the selection bbox: `max(64, 15 % of the longer bbox edge)`. */
export function emulationPadding(bbox: Rect): number {
  return Math.max(64, Math.round(0.15 * Math.max(bbox.w, bbox.h)));
}

/** The crop rect sent to the provider: the bbox grown by the padding, clamped to the canvas. */
export function emulationCropRect(bbox: Rect, docW: number, docH: number, padding = emulationPadding(bbox)): Rect {
  return Rect.intersect(Rect.inflate(bbox, padding), Rect.ofSize(docW, docH));
}

/** The short region hint prefixed to the user prompt when a mask is emulated. */
export function regionHint(prompt: string): string {
  return `Edit only the subject region in the middle of this image crop and keep the surrounding pixels unchanged. ${prompt.trim()}`;
}

/** `"<Provider>: <first 40 chars of prompt>"`. */
export function layerNameFor(providerName: string, prompt: string): string {
  const p = prompt.trim().replace(/\s+/g, " ");
  const head = p.length > 40 ? `${p.slice(0, 40).trimEnd()}…` : p;
  return `${providerName}: ${head || "untitled"}`;
}

/** Copy the part of a canvas-sized coverage mask inside `rect` into a rect-sized array. */
export function cropCoverage(mask: Uint8Array, maskW: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(Math.max(0, rect.w) * Math.max(0, rect.h));
  for (let y = 0; y < rect.h; y++) {
    const src = (rect.y + y) * maskW + rect.x;
    out.set(mask.subarray(src, src + rect.w), y * rect.w);
  }
  return out;
}

/** The soft mask used for compositing back: the selection, optionally feathered. */
export function blendMaskFor(selection: Selection, feather: number): Selection {
  return feather > 0 ? selection.feather(feather) : selection;
}

/** Resize `raster` to `w x h` (bilinear) unless it already matches. */
export function fitToSize(raster: Raster, w: number, h: number): Raster {
  return raster.width === w && raster.height === h ? raster : raster.resize(w, h, "bilinear");
}

/**
 * Keep only the pixels of `patch` that lie under `coverage` (both `w x h`): the output
 * alpha is `patch.alpha * coverage / 255`, colour is untouched. Compositing the result
 * over the original with normal "over" yields `base * (1 - m) + patch * m`, which is
 * what `pf_ai::mask::composite_back` computes — except this keeps the blend on its
 * own layer instead of flattening it.
 */
export function maskedPatch(patch: Raster, coverage: Uint8Array, w: number, h: number): Raster {
  if (coverage.length !== w * h) throw new RangeError(`maskedPatch: coverage length ${coverage.length} != ${w}x${h}`);
  const src = fitToSize(patch, w, h);
  const out = src === patch ? patch.clone() : src;
  const d = out.data;
  for (let i = 0, p = 3; i < coverage.length; i++, p += 4) {
    const m = coverage[i]!;
    if (m === 255) continue;
    d[p] = m === 0 ? 0 : Math.round((d[p]! * m) / 255);
  }
  return out;
}

/** A full-canvas transparent raster with `patch` pasted (bytes replaced) at `rect`. */
export function placeOnCanvas(patch: Raster, rect: Rect, docW: number, docH: number): Raster {
  const out = new Raster(docW, docH);
  out.blit(patch, rect.x, rect.y, undefined, { mode: "replace" });
  return out;
}

/**
 * Reference flatten (what the user sees after the new layer is added): `base` with the
 * masked patch composited over it. Used by tests and the diff overlay.
 */
export function compositeBackUnderMask(base: Raster, patch: Raster, coverage: Uint8Array, rect: Rect): Raster {
  const out = base.clone();
  out.blit(maskedPatch(patch, coverage, rect.w, rect.h), rect.x, rect.y);
  return out;
}

/** Bytes of a `w x h` RGBA raster, for request-size estimates before encoding. */
export function rawBytes(w: number, h: number): number {
  return w * h * 4;
}
