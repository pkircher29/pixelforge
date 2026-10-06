/**
 * `applyOp`: the single entry point that runs an op on a raster (GPU when available,
 * CPU otherwise), restricted to and masked by an optional selection.
 *
 * Returns only the affected region: `raster` is `dirtyRect.w x dirtyRect.h` and
 * `dirtyRect` is in the input raster's own coordinate space. Callers blit it back with
 * `{ mode: "replace" }` or hand it to `ReplaceLayerPixelsCommand`.
 */

import { Raster, Rect, type Point, type Selection } from "$lib/engine";
import { GpuOp, GpuOpError } from "./gpu";
import type { OpDef, ParamValues } from "./types";

export interface ApplyOptions {
  /** Doc-space position of the raster's origin (layer offset) so the selection lines up. Default 0,0. */
  offset?: Point;
  /** `"auto"` (default) prefers the GPU and falls back to CPU; `"cpu"` / `"gpu"` force a path. */
  backend?: "auto" | "cpu" | "gpu";
}

export interface ApplyResult {
  /** Pixels for `dirtyRect` (same size). Empty raster when nothing is selected. */
  raster: Raster;
  dirtyRect: Rect;
  /** Which path produced the pixels. */
  backend: "cpu" | "gpu";
}

let lastGpuFailure: string | null = null;

/** Message of the most recent GPU failure that caused a CPU fallback (for the status bar / demo). */
export function lastGpuError(): string | null {
  return lastGpuFailure;
}

/** Run an op on a whole raster with the chosen backend (no selection handling). */
export function runOp(op: OpDef, src: Raster, params: ParamValues, backend: "auto" | "cpu" | "gpu" = "auto"): { raster: Raster; backend: "cpu" | "gpu" } {
  if (backend !== "cpu") {
    const gpu = GpuOp.shared();
    if (gpu) {
      try {
        return { raster: gpu.run(src, op.glsl(params)), backend: "gpu" };
      } catch (e) {
        lastGpuFailure = e instanceof Error ? e.message : String(e);
        if (backend === "gpu") throw e;
        console.warn(`[pixelforge] GPU op "${op.id}" failed, using CPU:`, e);
      }
    } else if (backend === "gpu") {
      throw new GpuOpError("WebGL2 is not available");
    }
  }
  return { raster: op.cpu(src, params), backend: "cpu" };
}

/** Rect of `raster` touched by `selection` (raster space), or the whole raster when there is no selection. */
export function affectedRect(raster: Raster, selection: Selection | null | undefined, offset: Point = { x: 0, y: 0 }): Rect {
  if (!selection || selection.isEmpty) return raster.bounds();
  const bb = selection.bbox;
  if (!bb) return Rect.empty();
  return Rect.intersect(Rect.translate(bb, -offset.x, -offset.y), raster.bounds());
}

export function applyOp(
  op: OpDef,
  raster: Raster,
  params: ParamValues,
  selection?: Selection | null,
  opts: ApplyOptions = {},
): ApplyResult {
  const offset = opts.offset ?? { x: 0, y: 0 };
  const backend = opts.backend ?? "auto";
  const hasSel = !!selection && !selection.isEmpty;
  const dirty = affectedRect(raster, selection, offset);
  if (Rect.isEmpty(dirty)) return { raster: new Raster(0, 0), dirtyRect: dirty, backend: "cpu" };

  const margin = Math.max(0, Math.ceil(op.margin?.(params) ?? 0));
  const work = Rect.intersect(Rect.inflate(dirty, margin), raster.bounds());
  const wholeRaster = Rect.equals(work, raster.bounds());
  const src = wholeRaster ? raster : raster.crop(work);

  const { raster: out, backend: used } = runOp(op, src, params, backend);

  // Crop the result down to the dirty rect.
  const local = Rect.translate(dirty, -work.x, -work.y);
  const result = Rect.equals(local, out.bounds()) ? out : out.crop(local);

  if (hasSel && selection) {
    // Straight-alpha lerp towards the result by selection coverage.
    const m = selection.mask;
    const sw = selection.width;
    const d = result.data;
    const s = raster.data;
    for (let y = 0; y < dirty.h; y++) {
      const sy = dirty.y + y + offset.y;
      let di = y * dirty.w * 4;
      let si = ((dirty.y + y) * raster.width + dirty.x) * 4;
      let mi = sy * sw + dirty.x + offset.x;
      for (let x = 0; x < dirty.w; x++, di += 4, si += 4, mi++) {
        const cov = m[mi]!;
        if (cov === 255) continue;
        if (cov === 0) {
          d[di] = s[si]!;
          d[di + 1] = s[si + 1]!;
          d[di + 2] = s[si + 2]!;
          d[di + 3] = s[si + 3]!;
          continue;
        }
        const t = cov / 255;
        d[di] = s[si]! + (d[di]! - s[si]!) * t;
        d[di + 1] = s[si + 1]! + (d[di + 1]! - s[si + 1]!) * t;
        d[di + 2] = s[si + 2]! + (d[di + 2]! - s[si + 2]!) * t;
        d[di + 3] = s[si + 3]! + (d[di + 3]! - s[si + 3]!) * t;
      }
    }
  }
  return { raster: result, dirtyRect: dirty, backend: used };
}
