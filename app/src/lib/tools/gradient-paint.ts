/**
 * Paint a gradient between two points into a raster: linear / radial / angle / reflected /
 * diamond styles, blend mode, opacity, dither, transparency toggle, selection clip.
 */
import { BlendMode, Rect, blendRgb, gradientLut, type Gradient, type GradientStyle, type Point, type Raster, type Selection } from "$lib/engine";

export interface PaintGradientOptions {
  style: GradientStyle;
  reverse?: boolean;
  dither?: boolean;
  /** When false the gradient's alpha is ignored (opaque). */
  transparency?: boolean;
  opacity?: number;
  mode?: BlendMode;
  clip?: Selection | null;
  /** Document offset of the raster (clip is doc-space). */
  offset?: Point;
}

/** Cheap 2-D hash in [0,1) for ordered-looking dither. */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Gradient parameter t for a pixel given the drag line a→b and a style. */
export function gradientT(style: GradientStyle, x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 1;
  const len = Math.sqrt(len2);
  const px = x - a.x;
  const py = y - a.y;
  const proj = (px * dx + py * dy) / len2;
  switch (style) {
    case "radial":
      return Math.hypot(px, py) / len;
    case "angle": {
      const base = Math.atan2(dy, dx);
      let ang = Math.atan2(py, px) - base;
      ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return ang / (Math.PI * 2);
    }
    case "reflected":
      return Math.abs(proj);
    case "diamond": {
      const u = Math.abs(proj);
      const v = Math.abs((px * -dy + py * dx) / len2);
      return Math.max(u, v);
    }
    default:
      return proj;
  }
}

export function paintGradient(raster: Raster, a: Point, b: Point, gradient: Gradient, opts: PaintGradientOptions): Rect | null {
  const clip = opts.clip && !opts.clip.isEmpty ? opts.clip : null;
  const off = opts.offset ?? { x: 0, y: 0 };
  const opacity = opts.opacity ?? 1;
  let area = raster.bounds();
  if (clip) area = Rect.intersect(Rect.translate(clip.bbox!, -off.x, -off.y), area);
  if (Rect.isEmpty(area)) return null;
  const lut = gradientLut(gradient, opts.reverse ?? false);
  const d = raster.data;
  const w = raster.width;
  const dither = opts.dither ?? true;
  const transparency = opts.transparency ?? true;
  const mode = opts.mode ?? BlendMode.Normal;
  const tmp = new Float32Array(3);
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      let m = 1;
      if (clip) {
        m = clip.get(x + off.x, y + off.y) / 255;
        if (m === 0) continue;
      }
      let t = gradientT(opts.style, x + 0.5, y + 0.5, a, b);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (dither) t = Math.min(1, Math.max(0, t + (hash2(x, y) - 0.5) / 255));
      const li = Math.round(t * 255) * 4;
      const r = lut[li]!;
      const g = lut[li + 1]!;
      const bl = lut[li + 2]!;
      const al = transparency ? lut[li + 3]! / 255 : 1;
      const sa = al * m * opacity;
      if (sa <= 0) continue;
      const p = (y * w + x) * 4;
      const ba = d[p + 3]! / 255;
      let sr = r;
      let sg = g;
      let sb = bl;
      if (mode !== BlendMode.Normal && ba > 0) {
        blendRgb(mode, d[p]! / 255, d[p + 1]! / 255, d[p + 2]! / 255, r / 255, g / 255, bl / 255, tmp);
        // Blend result applies where the backdrop exists; straight source elsewhere.
        sr = (tmp[0]! * 255) * ba + r * (1 - ba);
        sg = (tmp[1]! * 255) * ba + g * (1 - ba);
        sb = (tmp[2]! * 255) * ba + bl * (1 - ba);
      }
      const ao = sa + ba * (1 - sa);
      const ws = sa / ao;
      const wd = (ba * (1 - sa)) / ao;
      d[p] = sr * ws + d[p]! * wd;
      d[p + 1] = sg * ws + d[p + 1]! * wd;
      d[p + 2] = sb * ws + d[p + 2]! * wd;
      d[p + 3] = ao * 255;
    }
  }
  return area;
}
