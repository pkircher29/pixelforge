/**
 * Select ▸ Modify ▸ Border / Smooth and Select ▸ Grow / Similar — pure selection ops
 * built on the engine `Selection` (Expand / Contract / Feather exist there).
 */
import { Selection, type Raster, type RGBA, type SelectionCombineMode } from "$lib/engine";
import { rangeWeight, rgbToHsl } from "./retouch-math";

export interface ChannelChoice {
  id: string;
  name: string;
}

export interface SelectionChannelResult {
  channelId: string | null;
  name: string;
  invert: boolean;
  mode: SelectionCombineMode;
}

export type ColorRangePreset = "sampled" | "reds" | "yellows" | "greens" | "cyans" | "blues" | "magentas" | "highlights" | "midtones" | "shadows";

const HUE_CENTER: Partial<Record<ColorRangePreset, number>> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };

/**
 * Select ▸ Color Range. `sampled` uses the engine's `Selection.fromColorRange` (fuzziness
 * PS 0..200 → 0..255); hue presets select saturated pixels within ±30° of the hue; tonal
 * presets use the dodge/burn range weights.
 */
export function colorRangeSelection(raster: Raster, preset: ColorRangePreset, samples: readonly RGBA[], fuzziness: number, invert: boolean): Selection {
  if (preset === "sampled") return Selection.fromColorRange(raster, samples, (fuzziness / 200) * 255, { invert });
  const s = new Selection(raster.width, raster.height);
  const d = raster.data;
  const m = s.mask;
  for (let i = 0, p = 0; i < m.length; i++, p += 4) {
    if (d[p + 3] === 0) {
      m[i] = invert ? 255 : 0;
      continue;
    }
    let v: number;
    const hc = HUE_CENTER[preset];
    if (hc !== undefined) {
      const [h, sat] = rgbToHsl(d[p]!, d[p + 1]!, d[p + 2]!);
      let dh = Math.abs(h * 360 - hc);
      if (dh > 180) dh = 360 - dh;
      v = sat < 0.15 ? 0 : dh <= 20 ? 1 : dh >= 40 ? 0 : 1 - (dh - 20) / 20;
    } else {
      const l = (0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!) / 255;
      v = Math.min(1, rangeWeight(preset as "shadows" | "midtones" | "highlights", l) * 1.4);
    }
    const c = Math.round(v * 255);
    m[i] = invert ? 255 - c : c;
  }
  s.invalidate();
  return s;
}

/** Border: a soft band of `width` px centred on the selection edge. */
export function borderSelection(sel: Selection, width: number): Selection {
  const half = Math.max(1, Math.round(width / 2));
  const outer = sel.expand(half);
  const inner = sel.contract(half);
  return outer.subtract(inner).feather(Math.max(0.5, width / 4));
}

/** Smooth: majority vote in a (2r+1)² window, hard result. */
export function smoothSelection(sel: Selection, radius: number): Selection {
  const r = Math.max(1, Math.round(radius));
  const w = sel.width;
  const h = sel.height;
  const out = new Selection(w, h);
  const m = sel.mask;
  // Integral image of the binarised mask.
  const ii = new Int32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += m[(y - 1) * w + (x - 1)]! >= 128 ? 1 : 0;
      ii[y * (w + 1) + x] = ii[(y - 1) * (w + 1) + x]! + row;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const on = ii[y1 * (w + 1) + x1]! - ii[y0 * (w + 1) + x1]! - ii[y1 * (w + 1) + x0]! + ii[y0 * (w + 1) + x0]!;
      const n = (y1 - y0) * (x1 - x0);
      out.mask[y * w + x] = on * 2 > n ? 255 : 0;
    }
  }
  return out;
}

function matches(d: Uint8ClampedArray, p: number, q: number, tol: number): boolean {
  return Math.abs(d[p]! - d[q]!) <= tol && Math.abs(d[p + 1]! - d[q + 1]!) <= tol && Math.abs(d[p + 2]! - d[q + 2]!) <= tol;
}

/**
 * Grow: add 4-connected neighbours whose colour is within `tolerance` of the adjacent
 * selected pixel (wand chaining from the selection boundary). `raster` is doc-sized.
 */
export function growSelection(sel: Selection, raster: Raster, tolerance: number): Selection {
  const w = sel.width;
  const h = sel.height;
  const out = sel.clone();
  const m = out.mask;
  const d = raster.data;
  const stack: number[] = [];
  for (let i = 0; i < m.length; i++) if (m[i]! >= 128) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const visit = (j: number): void => {
      if (m[j]! >= 128) return;
      if (!matches(d, i * 4, j * 4, tolerance)) return;
      m[j] = 255;
      stack.push(j);
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
  out.invalidate();
  return out;
}

/** Similar: every pixel in the image within `tolerance` of any selected colour (quantised palette). */
export function similarSelection(sel: Selection, raster: Raster, tolerance: number): Selection {
  const w = sel.width;
  const h = sel.height;
  const d = raster.data;
  const m = sel.mask;
  // Palette of selected colours quantised to 16 levels per channel.
  const seen = new Set<number>();
  const palette: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (m[i]! < 128) continue;
    const p = i * 4;
    const key = ((d[p]! >> 4) << 8) | ((d[p + 1]! >> 4) << 4) | (d[p + 2]! >> 4);
    if (seen.has(key)) continue;
    seen.add(key);
    palette.push(p);
    if (palette.length > 512) break;
  }
  const out = sel.clone();
  const o = out.mask;
  for (let i = 0; i < o.length; i++) {
    if (o[i]! >= 128) continue;
    const p = i * 4;
    for (const q of palette) {
      if (matches(d, p, q, tolerance)) {
        o[i] = 255;
        break;
      }
    }
  }
  out.invalidate();
  void w;
  void h;
  return out;
}
