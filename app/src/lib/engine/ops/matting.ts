/**
 * Layer ▸ Matting: Defringe and Remove Black / White Matte. Pure CPU, straight alpha.
 */

import { Raster } from "../raster";

/**
 * Defringe: replace the color of every edge pixel (alpha > 0 and within `px` of a
 * transparent pixel) with the color of the nearest pixel that is at least as far
 * inside, approximated by the alpha-weighted average of fully-opaque neighbours within
 * `px`. Alpha is untouched. Returns a new raster.
 */
export function defringe(src: Raster, px: number): Raster {
  const out = src.clone();
  const r = Math.max(1, Math.round(px));
  const w = src.width;
  const h = src.height;
  const s = src.data;
  const d = out.data;
  const isEdge = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (s[(ny * w + nx) * 4 + 3]! < 255) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = s[i + 3]!;
      if (a === 0) continue;
      if (a === 255 && !isEdge(x, y)) continue;
      // Average opaque, non-edge neighbours within r (fall back to opaque ones).
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let n = 0;
      let rr2 = 0;
      let gg2 = 0;
      let bb2 = 0;
      let n2 = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if ((dx === 0 && dy === 0) || dx * dx + dy * dy > r * r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = (ny * w + nx) * 4;
          if (s[j + 3]! < 255) continue;
          rr2 += s[j]!;
          gg2 += s[j + 1]!;
          bb2 += s[j + 2]!;
          n2++;
          if (isEdge(nx, ny)) continue;
          rr += s[j]!;
          gg += s[j + 1]!;
          bb += s[j + 2]!;
          n++;
        }
      }
      if (n > 0) {
        d[i] = rr / n;
        d[i + 1] = gg / n;
        d[i + 2] = bb / n;
      } else if (n2 > 0) {
        d[i] = rr2 / n2;
        d[i + 1] = gg2 / n2;
        d[i + 2] = bb2 / n2;
      }
    }
  }
  return out;
}

/**
 * Remove Black / White Matte: undo the color contamination of semi-transparent pixels
 * that were composited against black or white. For matte color `m` and stored color
 * `c` with alpha `a`: `c' = (c - m * (1 - a)) / a`, clamped. Fully opaque / transparent
 * pixels are untouched. Returns a new raster.
 */
export function removeMatte(src: Raster, matte: "black" | "white"): Raster {
  const out = src.clone();
  const m = matte === "black" ? 0 : 255;
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    if (a <= 0 || a >= 1) continue;
    for (let c = 0; c < 3; c++) {
      const v = (d[i + c]! - m * (1 - a)) / a;
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}
