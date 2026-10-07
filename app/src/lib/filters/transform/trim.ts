/**
 * Image > Trim: find the crop rect that removes transparent (or edge-coloured) borders
 * from the composite.
 */

import { Rect, compositeToRaster, type Document } from "$lib/engine";

export type TrimBasis = "transparent" | "top-left" | "bottom-right";

export interface TrimOptions {
  basis?: TrimBasis;
  /** Per-channel tolerance 0..255 when matching the edge color. Default 0. */
  tolerance?: number;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

/** Returns the rect to keep, or `null` when nothing would change (or everything would be trimmed). */
export function trimRect(doc: Document, opts: TrimOptions = {}): Rect | null {
  const basis = opts.basis ?? "transparent";
  const tol = opts.tolerance ?? 0;
  const comp = compositeToRaster(doc);
  const w = comp.width;
  const h = comp.height;
  const d = comp.data;
  let ref: [number, number, number, number] | null = null;
  if (basis !== "transparent") {
    const i = basis === "top-left" ? 0 : (w * h - 1) * 4;
    ref = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
  }
  const isBg = (i: number): boolean => {
    if (!ref) return d[i + 3] === 0;
    if (ref[3] === 0 && d[i + 3] === 0) return true;
    return (
      Math.abs(d[i]! - ref[0]) <= tol &&
      Math.abs(d[i + 1]! - ref[1]) <= tol &&
      Math.abs(d[i + 2]! - ref[2]) <= tol &&
      Math.abs(d[i + 3]! - ref[3]) <= tol
    );
  };
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      if (isBg(i)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  const keep = Rect.make(
    opts.left === false ? 0 : x0,
    opts.top === false ? 0 : y0,
    0,
    0,
  );
  const right = opts.right === false ? w : x1 + 1;
  const bottom = opts.bottom === false ? h : y1 + 1;
  keep.w = right - keep.x;
  keep.h = bottom - keep.y;
  if (Rect.equals(keep, Rect.ofSize(w, h))) return null;
  return keep;
}
