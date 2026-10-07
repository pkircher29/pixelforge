/**
 * Layer styles (Photoshop "Layer Effects") on the CPU.
 *
 * `renderLayerStyle(src, effects, fillOpacity)` turns a layer's (already masked) source
 * raster into the styled result: an RGBA raster enlarged by `effectExtent(effects)` on
 * every side, with the PS render order
 *
 *   drop shadow → outer glow → fill (× fillOpacity) → inner shadow → inner glow →
 *   bevel & emboss → color overlay → gradient overlay → stroke
 *
 * Shadows / glows / strokes are built from the shape's coverage (alpha) with the
 * distance transform (spread / choke / expand) and a Gaussian blur (`size`); bevel &
 * emboss is a distance-field height map lit by a directional light (simplified but
 * convincing). Every effect blends with its own blend mode and opacity using the W3C
 * compositing formula, so results match the main compositor's blend math.
 *
 * Used by the CPU compositor (exports, thumbnails, tests, Canvas2D fallback) and by the
 * GL compositor, which caches the styled raster as a texture (see GlCompositor).
 */

import { Rect } from "../rect";
import { Raster } from "../raster";
import { compositeStraight } from "../blend";
import { BlendMode, type BevelEmbossEffect, type DropShadowEffect, type EffectBase, type Gradient, type GradientStyle, type InnerGlowEffect, type InnerShadowEffect, type LayerEffects, type OuterGlowEffect, type RGBA, type StrokeEffect, type ColorOverlayEffect, type GradientOverlayEffect } from "../types";
import { blurCoverage, dilateCoverage, distanceInside, distanceOutside, erodeCoverage } from "./distance";
import { gradientLut, gradientParam } from "./fill";

/** PS defaults for global light. */
export const DEFAULT_GLOBAL_LIGHT_ANGLE = 120;
export const DEFAULT_GLOBAL_LIGHT_ALTITUDE = 30;

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
const GLOW_YELLOW: RGBA = { r: 255, g: 255, b: 190, a: 255 };
const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };

// ---------------------------------------------------------------------------
// Defaults (PS Layer Style dialog defaults)
// ---------------------------------------------------------------------------

export function defaultDropShadow(over: Partial<DropShadowEffect> = {}): DropShadowEffect {
  return { enabled: true, blendMode: BlendMode.Multiply, opacity: 0.75, color: { ...BLACK }, angle: 120, useGlobalLight: true, distance: 5, spread: 0, size: 5, knockout: true, ...over };
}

export function defaultInnerShadow(over: Partial<InnerShadowEffect> = {}): InnerShadowEffect {
  return { enabled: true, blendMode: BlendMode.Multiply, opacity: 0.75, color: { ...BLACK }, angle: 120, useGlobalLight: true, distance: 5, choke: 0, size: 5, ...over };
}

export function defaultOuterGlow(over: Partial<OuterGlowEffect> = {}): OuterGlowEffect {
  return { enabled: true, blendMode: BlendMode.Screen, opacity: 0.75, color: { ...GLOW_YELLOW }, spread: 0, size: 5, ...over };
}

export function defaultInnerGlow(over: Partial<InnerGlowEffect> = {}): InnerGlowEffect {
  return { enabled: true, blendMode: BlendMode.Screen, opacity: 0.75, color: { ...GLOW_YELLOW }, choke: 0, size: 5, source: "edge", ...over };
}

export function defaultBevelEmboss(over: Partial<BevelEmbossEffect> = {}): BevelEmbossEffect {
  return {
    enabled: true,
    blendMode: BlendMode.Normal,
    opacity: 1,
    style: "innerBevel",
    technique: "smooth",
    depth: 100,
    direction: "up",
    size: 5,
    soften: 0,
    angle: 120,
    altitude: 30,
    useGlobalLight: true,
    highlightMode: BlendMode.Screen,
    highlightColor: { ...WHITE },
    highlightOpacity: 0.75,
    shadowMode: BlendMode.Multiply,
    shadowColor: { ...BLACK },
    shadowOpacity: 0.75,
    ...over,
  };
}

export function defaultColorOverlay(over: Partial<ColorOverlayEffect> = {}): ColorOverlayEffect {
  return { enabled: true, blendMode: BlendMode.Normal, opacity: 1, color: { ...RED }, ...over };
}

export function defaultGradientOverlay(over: Partial<GradientOverlayEffect> = {}): GradientOverlayEffect {
  return {
    enabled: true,
    blendMode: BlendMode.Normal,
    opacity: 1,
    gradient: { stops: [{ pos: 0, color: { ...BLACK } }, { pos: 1, color: { ...WHITE } }] },
    style: "linear",
    angle: 90,
    scale: 1,
    reverse: false,
    alignWithLayer: true,
    ...over,
  };
}

export function defaultStroke(over: Partial<StrokeEffect> = {}): StrokeEffect {
  return { enabled: true, blendMode: BlendMode.Normal, opacity: 1, size: 3, position: "outside", fillType: "color", color: { ...RED }, gradient: null, gradientStyle: "linear", gradientAngle: 90, ...over };
}

/** Deep copy (effects are plain data). */
export function cloneEffects(e: LayerEffects | null): LayerEffects | null {
  return e ? (JSON.parse(JSON.stringify(e)) as LayerEffects) : null;
}

/** True when at least one effect is enabled. */
export function hasEnabledEffects(e: LayerEffects | null | undefined): boolean {
  if (!e) return false;
  return EFFECT_KEYS.some((k) => e[k]?.enabled);
}

const EFFECT_KEYS = ["dropShadow", "innerShadow", "outerGlow", "innerGlow", "bevelEmboss", "colorOverlay", "gradientOverlay", "stroke"] as const;

/**
 * Pixels the styled result extends beyond the layer's own bounds on every side (shadow
 * distance + size, glow size, outside stroke, outer bevel). 0 when nothing extends.
 */
export function effectExtent(e: LayerEffects | null | undefined): number {
  if (!e) return 0;
  let ext = 0;
  const ds = e.dropShadow;
  if (ds?.enabled) ext = Math.max(ext, ds.distance + ds.size + 1);
  const og = e.outerGlow;
  if (og?.enabled) ext = Math.max(ext, og.size + 1);
  const st = e.stroke;
  if (st?.enabled) ext = Math.max(ext, st.position === "outside" ? st.size + 1 : st.position === "center" ? st.size / 2 + 1 : 0);
  const be = e.bevelEmboss;
  if (be?.enabled && be.style !== "innerBevel") ext = Math.max(ext, be.size + be.soften + 1);
  return Math.ceil(ext);
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

/** Shift a coverage buffer by integer `dx, dy`; pixels shifted in from outside get `fillValue`. */
function shiftCoverage(cov: Float32Array, w: number, h: number, dx: number, dy: number, fillValue: number): Float32Array {
  const out = new Float32Array(cov.length);
  if (fillValue !== 0) out.fill(fillValue);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= w) continue;
      out[y * w + x] = cov[sy * w + sx]!;
    }
  }
  return out;
}

function lightOffset(angleDeg: number, distance: number): { dx: number; dy: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { dx: Math.round(-Math.cos(a) * distance), dy: Math.round(Math.sin(a) * distance) };
}

/** Coverage of a blurred, spread shadow/glow: hard expand by `spread%` of `size`, blur the rest. */
function softExpand(cov: Float32Array, w: number, h: number, size: number, spreadPct: number): Float32Array {
  const expand = (Math.max(0, Math.min(100, spreadPct)) / 100) * size;
  const blur = Math.max(0, size - expand);
  let c = expand > 0 ? dilateCoverage(cov, w, h, expand) : cov;
  if (blur > 0) c = blurCoverage(c, w, h, blur / 2);
  else if (c === cov) c = new Float32Array(cov);
  return c;
}

const px = new Float32Array(4);

/**
 * Blend a constant color (or per-pixel color buffer, straight 0..1 RGB) with coverage
 * `cov` over the premultiplied float buffer `dst` using `mode` at `opacity`.
 */
function blendInto(
  dst: Float32Array,
  cov: Float32Array,
  color: RGBA | Float32Array,
  mode: BlendMode,
  opacity: number,
  colorAlpha: Float32Array | null = null,
): void {
  const constant = !(color instanceof Float32Array);
  const cr = constant ? color.r / 255 : 0;
  const cg = constant ? color.g / 255 : 0;
  const cb = constant ? color.b / 255 : 0;
  const ca = constant ? color.a / 255 : 1;
  for (let i = 0, p = 0; i < cov.length; i++, p += 4) {
    let as = cov[i]! * opacity * ca;
    if (colorAlpha) as *= colorAlpha[i]!;
    if (as <= 0.0005) continue;
    const ab = dst[p + 3]!;
    const br = ab > 0 ? dst[p]! / ab : 0;
    const bg = ab > 0 ? dst[p + 1]! / ab : 0;
    const bb = ab > 0 ? dst[p + 2]! / ab : 0;
    const sr = constant ? cr : (color as Float32Array)[i * 3]!;
    const sg = constant ? cg : (color as Float32Array)[i * 3 + 1]!;
    const sb = constant ? cb : (color as Float32Array)[i * 3 + 2]!;
    compositeStraight(mode, br, bg, bb, ab, sr, sg, sb, as, px);
    const ao = px[3]!;
    dst[p] = px[0]! * ao;
    dst[p + 1] = px[1]! * ao;
    dst[p + 2] = px[2]! * ao;
    dst[p + 3] = ao;
  }
}

/** Per-pixel gradient color (straight RGB 0..1) + alpha buffers over `bounds`. */
function gradientBuffers(
  w: number,
  h: number,
  gradient: Gradient,
  style: GradientStyle,
  angle: number,
  scale: number,
  reverse: boolean,
  bounds: Rect,
): { rgb: Float32Array; alpha: Float32Array } {
  const lut = gradientLut(gradient, reverse);
  const rgb = new Float32Array(w * h * 3);
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = gradientParam(style, x + 0.5, y + 0.5, bounds, angle, scale, { x: 0, y: 0 });
      const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
      rgb[i * 3] = lut[k]! / 255;
      rgb[i * 3 + 1] = lut[k + 1]! / 255;
      rgb[i * 3 + 2] = lut[k + 2]! / 255;
      alpha[i] = lut[k + 3]! / 255;
    }
  }
  return { rgb, alpha };
}

function coverageBounds(cov: Float32Array, w: number, h: number): Rect {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cov[y * w + x]! > 0.002) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? Rect.ofSize(w, h) : Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

function globalAngle(e: LayerEffects, fx: { useGlobalLight: boolean; angle: number }): number {
  return fx.useGlobalLight ? (e.globalLightAngle ?? DEFAULT_GLOBAL_LIGHT_ANGLE) : fx.angle;
}

// ---------------------------------------------------------------------------
// Bevel & Emboss
// ---------------------------------------------------------------------------

/** Height map 0..1 rising from the shape edge inwards over `size` px. */
function innerHeight(cov: Float32Array, w: number, h: number, fx: BevelEmbossEffect): Float32Array {
  const size = Math.max(0.5, fx.size);
  if (fx.technique === "smooth") {
    const b = blurCoverage(cov, w, h, size / 2);
    // Blurring softens both sides; keep only the inside ramp, rescaled to 0..1.
    const out = new Float32Array(cov.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(1, (b[i]! - 0.5) * 2)) * (cov[i]! > 0 ? 1 : 0);
    return out;
  }
  const dist = distanceInside(cov, w, h);
  const out = new Float32Array(cov.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, dist[i]! / size) * (cov[i]! >= 0.5 ? 1 : cov[i]!);
  return fx.technique === "chiselSoft" ? blurCoverage(out, w, h, 1) : out;
}

/** Height map 1..0 falling from the shape edge outwards over `size` px. */
function outerHeight(cov: Float32Array, w: number, h: number, fx: BevelEmbossEffect): Float32Array {
  const size = Math.max(0.5, fx.size);
  if (fx.technique === "smooth") {
    const b = blurCoverage(cov, w, h, size / 2);
    const out = new Float32Array(cov.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(1, b[i]! * 2)) * (cov[i]! < 1 ? 1 : 0);
    return out;
  }
  const dist = distanceOutside(cov, w, h);
  const out = new Float32Array(cov.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, 1 - dist[i]! / size);
  return fx.technique === "chiselSoft" ? blurCoverage(out, w, h, 1) : out;
}

/**
 * Light a height map: returns highlight / shadow coverages (0..1) from the slope facing
 * the light. `depth` scales the slope; `direction: "down"` swaps the two.
 */
function lightHeightMap(
  height: Float32Array,
  w: number,
  h: number,
  fx: BevelEmbossEffect,
  angleDeg: number,
  altitudeDeg: number,
): { highlight: Float32Array; shadow: Float32Array } {
  const hm = fx.soften > 0 ? blurCoverage(height, w, h, fx.soften) : height;
  const a = (angleDeg * Math.PI) / 180;
  const alt = (Math.max(0, Math.min(90, altitudeDeg)) * Math.PI) / 180;
  const lx = Math.cos(a) * Math.cos(alt);
  const ly = -Math.sin(a) * Math.cos(alt);
  const lz = Math.sin(alt);
  const flat = lz;
  const slope = (Math.max(1, fx.depth) / 100) * Math.max(1, fx.size);
  const highlight = new Float32Array(w * h);
  const shadow = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xl = x > 0 ? hm[i - 1]! : hm[i]!;
      const xr = x < w - 1 ? hm[i + 1]! : hm[i]!;
      const yu = y > 0 ? hm[i - w]! : hm[i]!;
      const yd = y < h - 1 ? hm[i + w]! : hm[i]!;
      const gx = ((xr - xl) / 2) * slope;
      const gy = ((yd - yu) / 2) * slope;
      // Normal of the surface z = height(x, y): (-gx, -gy, 1).
      const nl = Math.hypot(gx, gy, 1);
      const shade = (-gx * lx - gy * ly + lz) / nl;
      const diff = shade - flat;
      const hi = Math.max(0, Math.min(1, diff / Math.max(0.05, 1 - flat)));
      const sh = Math.max(0, Math.min(1, -diff / Math.max(0.05, flat + 0.3)));
      if (fx.direction === "up") {
        highlight[i] = hi;
        shadow[i] = sh;
      } else {
        highlight[i] = sh;
        shadow[i] = hi;
      }
    }
  }
  return { highlight, shadow };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface StyledRaster {
  /** The styled layer, straight alpha, `src.width + 2 * extent` x `src.height + 2 * extent`. */
  raster: Raster;
  /** Add to the layer's offset to place `raster` (always `-extent`). */
  dx: number;
  dy: number;
  /** Padding that was added on every side. */
  extent: number;
}

/**
 * Render a layer's effects. `src` is the layer's source pixels with its mask already
 * applied (straight alpha). `fillOpacity` scales the source pixels only. The result is
 * placed at `layer.offset + (dx, dy)`.
 */
export function renderLayerStyle(src: Raster, effects: LayerEffects, fillOpacity = 1): StyledRaster {
  const e = effectExtent(effects);
  const w = src.width + 2 * e;
  const h = src.height + 2 * e;
  const n = w * h;
  const cov = new Float32Array(n);
  const interior = new Float32Array(n * 4);
  const below = new Float32Array(n * 4);
  const s = src.data;
  const fo = Math.max(0, Math.min(1, fillOpacity));
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const a = s[si + 3]! / 255;
      if (a <= 0) continue;
      const di = (y + e) * w + (x + e);
      cov[di] = a;
      const pa = a * fo;
      interior[di * 4] = (s[si]! / 255) * pa;
      interior[di * 4 + 1] = (s[si + 1]! / 255) * pa;
      interior[di * 4 + 2] = (s[si + 2]! / 255) * pa;
      interior[di * 4 + 3] = pa;
    }
  }
  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = 1 - cov[i]!;

  // ---- below the layer: drop shadow, outer glow, outer bevel / emboss (outside part)
  const ds = effects.dropShadow;
  if (ds?.enabled && ds.opacity > 0) {
    const { dx, dy } = lightOffset(globalAngle(effects, ds), ds.distance);
    let c = shiftCoverage(cov, w, h, dx, dy, 0);
    c = softExpand(c, w, h, ds.size, ds.spread);
    if (ds.knockout) for (let i = 0; i < n; i++) c[i] = c[i]! * inv[i]!;
    blendInto(below, c, ds.color, ds.blendMode, ds.opacity);
  }
  const og = effects.outerGlow;
  if (og?.enabled && og.opacity > 0) {
    const c = softExpand(cov, w, h, og.size, og.spread);
    for (let i = 0; i < n; i++) c[i] = c[i]! * inv[i]!;
    blendInto(below, c, og.color, og.blendMode, og.opacity);
  }

  // ---- interior effects (over the fill, bounded by the shape)
  const is = effects.innerShadow;
  if (is?.enabled && is.opacity > 0) {
    const { dx, dy } = lightOffset(globalAngle(effects, is), is.distance);
    let c = shiftCoverage(inv, w, h, dx, dy, 1);
    c = softExpand(c, w, h, is.size, is.choke);
    for (let i = 0; i < n; i++) c[i] = c[i]! * cov[i]!;
    blendInto(interior, c, is.color, is.blendMode, is.opacity);
  }
  const ig = effects.innerGlow;
  if (ig?.enabled && ig.opacity > 0) {
    let c: Float32Array;
    if (ig.source === "edge") {
      c = softExpand(inv, w, h, ig.size, ig.choke);
    } else {
      const dist = distanceInside(cov, w, h);
      c = new Float32Array(n);
      const size = Math.max(0.5, ig.size);
      for (let i = 0; i < n; i++) c[i] = Math.min(1, dist[i]! / size);
      if (ig.choke > 0) c = dilateCoverage(c, w, h, (ig.choke / 100) * size);
    }
    for (let i = 0; i < n; i++) c[i] = c[i]! * cov[i]!;
    blendInto(interior, c, ig.color, ig.blendMode, ig.opacity);
  }
  const be = effects.bevelEmboss;
  if (be?.enabled && be.opacity > 0) {
    const angle = globalAngle(effects, be);
    const altitude = be.useGlobalLight ? (effects.globalLightAltitude ?? DEFAULT_GLOBAL_LIGHT_ALTITUDE) : be.altitude;
    const inside = be.style !== "outerBevel";
    const outside = be.style !== "innerBevel";
    if (inside) {
      const hm = innerHeight(cov, w, h, be);
      if (be.style === "pillowEmboss") for (let i = 0; i < n; i++) hm[i] = 1 - hm[i]!;
      const { highlight, shadow } = lightHeightMap(hm, w, h, be, angle, altitude);
      for (let i = 0; i < n; i++) {
        highlight[i] = highlight[i]! * cov[i]!;
        shadow[i] = shadow[i]! * cov[i]!;
      }
      blendInto(interior, highlight, be.highlightColor, be.highlightMode, be.highlightOpacity * be.opacity);
      blendInto(interior, shadow, be.shadowColor, be.shadowMode, be.shadowOpacity * be.opacity);
    }
    if (outside) {
      const hm = outerHeight(cov, w, h, be);
      if (be.style === "emboss" || be.style === "pillowEmboss") {
        // Emboss continues the inner slope outwards (height keeps falling).
        for (let i = 0; i < n; i++) hm[i] = hm[i]! - 1;
      }
      const { highlight, shadow } = lightHeightMap(hm, w, h, be, angle, altitude);
      for (let i = 0; i < n; i++) {
        highlight[i] = highlight[i]! * inv[i]!;
        shadow[i] = shadow[i]! * inv[i]!;
      }
      blendInto(below, highlight, be.highlightColor, be.highlightMode, be.highlightOpacity * be.opacity);
      blendInto(below, shadow, be.shadowColor, be.shadowMode, be.shadowOpacity * be.opacity);
    }
  }
  const co = effects.colorOverlay;
  if (co?.enabled && co.opacity > 0) blendInto(interior, cov, co.color, co.blendMode, co.opacity);
  const go = effects.gradientOverlay;
  if (go?.enabled && go.opacity > 0) {
    const bounds = go.alignWithLayer ? coverageBounds(cov, w, h) : Rect.ofSize(w, h);
    const g = gradientBuffers(w, h, go.gradient, go.style, go.angle, go.scale, go.reverse, bounds);
    blendInto(interior, cov, g.rgb, go.blendMode, go.opacity, g.alpha);
  }
  const st = effects.stroke;
  if (st?.enabled && st.opacity > 0 && st.size > 0) {
    let c: Float32Array;
    if (st.position === "outside") {
      const d = dilateCoverage(cov, w, h, st.size);
      c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.max(0, d[i]! - cov[i]!);
    } else if (st.position === "inside") {
      const er = erodeCoverage(cov, w, h, st.size);
      c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.max(0, cov[i]! - er[i]!);
    } else {
      const d = dilateCoverage(cov, w, h, st.size / 2);
      const er = erodeCoverage(cov, w, h, st.size / 2);
      c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.max(0, d[i]! - er[i]!);
    }
    if (st.fillType === "gradient" && st.gradient) {
      const g = gradientBuffers(w, h, st.gradient, st.gradientStyle, st.gradientAngle, 1, false, coverageBounds(c, w, h));
      blendInto(interior, c, g.rgb, st.blendMode, st.opacity, g.alpha);
    } else {
      blendInto(interior, c, st.color, st.blendMode, st.opacity);
    }
  }

  // ---- interior over below → straight RGBA8
  const out = new Raster(w, h);
  const d = out.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const ia = interior[p + 3]!;
    const ba = below[p + 3]!;
    const a = ia + ba * (1 - ia);
    if (a <= 0) continue;
    const r = interior[p]! + below[p]! * (1 - ia);
    const g = interior[p + 1]! + below[p + 1]! * (1 - ia);
    const b = interior[p + 2]! + below[p + 2]! * (1 - ia);
    d[p] = (r / a) * 255;
    d[p + 1] = (g / a) * 255;
    d[p + 2] = (b / a) * 255;
    d[p + 3] = a * 255;
  }
  return { raster: out, dx: -e, dy: -e, extent: e };
}

/** Multiply a raster's alpha by a mask's red channel (same size), returning a new raster. */
export function applyMaskToRaster(src: Raster, mask: Raster): Raster {
  const out = src.clone();
  const d = out.data;
  const m = mask.data;
  if (mask.width !== src.width || mask.height !== src.height) {
    // Mask of a different size: treat as document-anchored at 0,0 (clip).
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const mv = x < mask.width && y < mask.height ? m[(y * mask.width + x) * 4]! : 0;
        d[i + 3] = (d[i + 3]! * mv) / 255;
      }
    }
    return out;
  }
  for (let i = 0; i < d.length; i += 4) d[i + 3] = (d[i + 3]! * m[i]!) / 255;
  return out;
}

/** Type guard helper for the effects record. */
export function enabledEffect<T extends EffectBase>(fx: T | undefined): fx is T {
  return !!fx && fx.enabled;
}
