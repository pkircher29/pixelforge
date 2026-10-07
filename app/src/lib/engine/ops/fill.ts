/**
 * Fill rasterization: solid colors, Photoshop-style gradients (linear / radial / angle
 * / reflected / diamond) and tiled patterns. Used by fill layers, shape fills, gradient
 * overlays and gradient strokes. Pure CPU.
 */

import { Rect, type Point } from "../rect";
import { Raster } from "../raster";
import type { FillSpec, Gradient, GradientFill, GradientStyle, PatternFill, RGBA, SolidFill } from "../types";

/** Interpolate the gradient at `t` (clamped 0..1) into `out` (straight RGBA, 0..255 floats). */
export function gradientColorAt(g: Gradient, t: number, out: RGBA): RGBA {
  const stops = g.stops;
  if (stops.length === 0) {
    out.r = out.g = out.b = out.a = 0;
    return out;
  }
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  let lo = stops[0]!;
  let hi = stops[stops.length - 1]!;
  if (tt <= lo.pos) {
    out.r = lo.color.r;
    out.g = lo.color.g;
    out.b = lo.color.b;
    out.a = lo.color.a;
    return out;
  }
  if (tt >= hi.pos) {
    out.r = hi.color.r;
    out.g = hi.color.g;
    out.b = hi.color.b;
    out.a = hi.color.a;
    return out;
  }
  for (let i = 0; i + 1 < stops.length; i++) {
    if (stops[i]!.pos <= tt && stops[i + 1]!.pos >= tt) {
      lo = stops[i]!;
      hi = stops[i + 1]!;
      break;
    }
  }
  const span = hi.pos - lo.pos;
  const f = span <= 0 ? 0 : (tt - lo.pos) / span;
  out.r = lo.color.r + (hi.color.r - lo.color.r) * f;
  out.g = lo.color.g + (hi.color.g - lo.color.g) * f;
  out.b = lo.color.b + (hi.color.b - lo.color.b) * f;
  out.a = lo.color.a + (hi.color.a - lo.color.a) * f;
  return out;
}

/** A sorted copy of a gradient's stops (by `pos`). */
export function normalizeGradient(g: Gradient): Gradient {
  return { stops: g.stops.slice().sort((a, b) => a.pos - b.pos) };
}

/** Evaluate a gradient into a 256-entry RGBA LUT (0..255 floats). */
export function gradientLut(g: Gradient, reverse = false): Float32Array {
  const lut = new Float32Array(256 * 4);
  const c: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  const ng = normalizeGradient(g);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    gradientColorAt(ng, reverse ? 1 - t : t, c);
    lut[i * 4] = c.r;
    lut[i * 4 + 1] = c.g;
    lut[i * 4 + 2] = c.b;
    lut[i * 4 + 3] = c.a;
  }
  return lut;
}

/**
 * Gradient parameter `t` (0..1, unclamped for linear) at a point for a gradient laid out
 * over `bounds`. PS angle convention: 0° = left→right, 90° = bottom→top. `scale`
 * stretches the ramp around the centre; `offset` (fraction of bounds) moves the centre.
 */
export function gradientParam(
  style: GradientStyle,
  x: number,
  y: number,
  bounds: Rect,
  angleDeg: number,
  scale: number,
  offset: Point,
): number {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const cx = bounds.x + bounds.w * (0.5 + offset.x);
  const cy = bounds.y + bounds.h * (0.5 + offset.y);
  const px = x - cx;
  const py = y - cy;
  const s = Math.max(1e-3, scale);
  // Half-extent of the bounds projected onto the gradient direction.
  const halfLen = Math.max(1e-3, (Math.abs(bounds.w * dx) + Math.abs(bounds.h * dy)) / 2);
  const along = (px * dx + py * dy) / s;
  const across = (-px * dy + py * dx) / s;
  switch (style) {
    case "linear":
      return 0.5 + along / (2 * halfLen);
    case "reflected":
      return Math.abs(along) / halfLen;
    case "radial": {
      const r = Math.max(1e-3, Math.max(bounds.w, bounds.h) / 2);
      return Math.hypot(px, py) / (s * r);
    }
    case "angle": {
      let t = Math.atan2(-py, px) - a;
      t /= 2 * Math.PI;
      t -= Math.floor(t);
      return t;
    }
    case "diamond": {
      const r = Math.max(1e-3, Math.max(bounds.w, bounds.h) / 2);
      return (Math.abs(along) + Math.abs(across)) / r;
    }
  }
  return 0;
}

/**
 * Render a gradient into a `w x h` raster, laid out over `bounds` (default: the whole
 * raster). Pixels are sampled at their centres.
 */
export function renderGradient(fill: GradientFill, w: number, h: number, bounds?: Rect): Raster {
  const out = new Raster(w, h);
  const b = bounds ?? Rect.ofSize(w, h);
  const lut = gradientLut(fill.gradient, fill.reverse);
  const d = out.data;
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const t = gradientParam(fill.style, x + 0.5, y + 0.5, b, fill.angle, fill.scale, fill.offset);
      const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
      d[i] = lut[k]!;
      d[i + 1] = lut[k + 1]!;
      d[i + 2] = lut[k + 2]!;
      d[i + 3] = lut[k + 3]!;
    }
  }
  return out;
}

/** Tile a pattern raster across `w x h` (nearest-neighbour when scaled). */
export function renderPattern(fill: PatternFill, w: number, h: number): Raster {
  const out = new Raster(w, h);
  const p = fill.pattern;
  if (p.width === 0 || p.height === 0) return out;
  const s = Math.max(1e-3, fill.scale);
  const d = out.data;
  const src = p.data;
  const tw = p.width;
  const th = p.height;
  let i = 0;
  for (let y = 0; y < h; y++) {
    let sy = Math.floor((y - fill.offset.y) / s) % th;
    if (sy < 0) sy += th;
    for (let x = 0; x < w; x++, i += 4) {
      let sx = Math.floor((x - fill.offset.x) / s) % tw;
      if (sx < 0) sx += tw;
      const si = (sy * tw + sx) * 4;
      d[i] = src[si]!;
      d[i + 1] = src[si + 1]!;
      d[i + 2] = src[si + 2]!;
      d[i + 3] = src[si + 3]!;
    }
  }
  return out;
}

/** Render any fill spec into a `w x h` raster. Gradients are laid out over `bounds`. */
export function renderFill(spec: FillSpec, w: number, h: number, bounds?: Rect): Raster {
  switch (spec.type) {
    case "solid":
      return Raster.filled(w, h, spec.color);
    case "gradient":
      return renderGradient(spec, w, h, bounds);
    case "pattern":
      return renderPattern(spec, w, h);
  }
}

/** Convenience constructors. */
export function solidFill(color: RGBA): SolidFill {
  return { type: "solid", color: { ...color } };
}

export function gradientFill(stops: { pos: number; color: RGBA }[], over: Partial<Omit<GradientFill, "type" | "gradient">> = {}): GradientFill {
  return {
    type: "gradient",
    gradient: { stops: stops.map((s) => ({ pos: s.pos, color: { ...s.color } })) },
    style: over.style ?? "linear",
    angle: over.angle ?? 90,
    scale: over.scale ?? 1,
    reverse: over.reverse ?? false,
    offset: over.offset ? { ...over.offset } : { x: 0, y: 0 },
  };
}

export function patternFill(pattern: Raster, over: Partial<Omit<PatternFill, "type" | "pattern">> = {}): PatternFill {
  return { type: "pattern", pattern, scale: over.scale ?? 1, offset: over.offset ? { ...over.offset } : { x: 0, y: 0 } };
}

/** Deep copy of a fill spec (pattern rasters are cloned). */
export function cloneFill<T extends FillSpec>(spec: T): T {
  switch (spec.type) {
    case "solid":
      return { type: "solid", color: { ...spec.color } } as T;
    case "gradient":
      return gradientFill(spec.gradient.stops, spec) as T;
    case "pattern":
      return patternFill(spec.pattern.clone(), spec) as T;
  }
}
