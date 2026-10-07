/**
 * Brush engine (tools-v2). Shared by Brush, Pencil, Eraser, Clone / Pattern / History
 * stamps, Healing, Color Replacement, Background Eraser, Blur / Sharpen / Smudge and
 * Dodge / Burn / Sponge.
 *
 * Model: a stroke owns a float coverage buffer the size of the target raster. Dabs add
 * `flow`-weighted coverage (capped at 1); pixels are always recomputed from the
 * *pre-stroke snapshot* so overlapping dabs never exceed the stroke `opacity` (Photoshop
 * semantics). What a covered pixel becomes is decided by the stroke's `blend`:
 *
 * - `color`   paint `color` (brush, pencil, mask painting)
 * - `erase`   alpha → 0 (eraser)
 * - `source`  copy pixels from `sourceAt(x, y)` (clone / pattern / history stamps)
 * - `target`  a lazily computed per-rect "target" raster derived from the snapshot
 *             (blur, sharpen, dodge, burn, sponge, colour replacement, background eraser)
 * - `smudge`  sequential finger-painting (handled per dab, not from the snapshot)
 *
 * Pure parts (dab placement, smoothing, dab masks) are exported for tests.
 */
import { Rect, type Point, type Raster, type RGBA, type Selection } from "$lib/engine";
import { Rng, randomSeed } from "./rng";
import { ROUND_TIP, sampleTip, tipById, TIP_SIZE, type BrushTip } from "./brush-tips";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Brush Settings panel model (PS sections). Percentages are 0..100 unless noted. */
export interface BrushSettings {
  tip: string;
  /** Diameter px. */
  size: number;
  /** Round tip only. */
  hardness: number;
  /** % of diameter. */
  spacing: number;
  /** Degrees. */
  angle: number;
  /** 1..100 (100 = circle). */
  roundness: number;
  flipX: boolean;
  flipY: boolean;
  // Shape Dynamics
  shapeDynamics: boolean;
  sizeJitter: number;
  /** Minimum diameter % when size varies. */
  minDiameter: number;
  angleJitter: number;
  roundnessJitter: number;
  /** Pen pressure → size. */
  pressureSize: boolean;
  // Scattering
  scattering: boolean;
  /** 0..1000 (% of diameter). */
  scatter: number;
  scatterBoth: boolean;
  /** 1..16 dabs per spacing step. */
  count: number;
  countJitter: number;
  // Transfer
  transfer: boolean;
  opacityJitter: number;
  flowJitter: number;
  pressureOpacity: boolean;
  // Smoothing (pull-string %, 0 = off)
  smoothing: number;
  /** Airbrush build-up: dabs keep accumulating while the pointer rests. */
  buildUp: boolean;
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  tip: "round",
  size: 24,
  hardness: 80,
  spacing: 25,
  angle: 0,
  roundness: 100,
  flipX: false,
  flipY: false,
  shapeDynamics: false,
  sizeJitter: 0,
  minDiameter: 25,
  angleJitter: 0,
  roundnessJitter: 0,
  pressureSize: true,
  scattering: false,
  scatter: 0,
  scatterBoth: false,
  count: 1,
  countJitter: 0,
  transfer: false,
  opacityJitter: 0,
  flowJitter: 0,
  pressureOpacity: false,
  smoothing: 0,
  buildUp: false,
};

export function normalizeBrushSettings(s: Partial<BrushSettings> | null | undefined): BrushSettings {
  const out: BrushSettings = { ...DEFAULT_BRUSH_SETTINGS, ...(s ?? {}) };
  out.size = Math.max(1, Math.min(2500, out.size));
  out.hardness = Math.max(0, Math.min(100, out.hardness));
  out.spacing = Math.max(1, Math.min(1000, out.spacing));
  out.roundness = Math.max(1, Math.min(100, out.roundness));
  out.count = Math.max(1, Math.min(16, Math.round(out.count)));
  return out;
}

// ---------------------------------------------------------------------------
// Dab placement (pure)
// ---------------------------------------------------------------------------

export interface Dab {
  x: number;
  y: number;
  /** Diameter px. */
  size: number;
  /** Degrees. */
  angle: number;
  /** 0..1 */
  roundness: number;
  /** Multiplier 0..1 applied to the stroke opacity (transfer jitter / pressure). */
  opacity: number;
  /** Multiplier 0..1 applied to the stroke flow. */
  flow: number;
}

export interface PlacementState {
  /** Distance travelled since the last dab. */
  carry: number;
  /** Last pointer position (null before the first dab). */
  last: Point | null;
  /** Direction of travel in degrees (for "angle follows direction" tips). */
  heading: number;
}

/** Spacing in px from a percentage of the diameter (Photoshop default 25 %). */
export function spacingPx(diameter: number, spacingPct: number): number {
  return Math.max(0.5, (diameter * spacingPct) / 100);
}

/** Effective diameter for a pointer sample. */
export function pressureDiameter(diameter: number, pressure: number, pointerType: string, enabled: boolean, minPct = 0): number {
  if (!enabled || pointerType !== "pen") return diameter;
  const p = Math.max(0, Math.min(1, pressure));
  const lo = (diameter * minPct) / 100;
  return Math.max(1, lo + (diameter - lo) * p);
}

/** Build one dab at `p` applying the jitter sections of `s`. */
export function makeDab(p: Point, baseSize: number, s: BrushSettings, rng: Rng, pressure: number, pointerType: string, heading: number): Dab {
  let size = baseSize;
  let angle = s.angle;
  let roundness = s.roundness / 100;
  if (s.shapeDynamics) {
    if (s.sizeJitter > 0) {
      const lo = Math.min(1, s.minDiameter / 100);
      const j = 1 - (s.sizeJitter / 100) * rng.next() * (1 - lo);
      size = baseSize * j;
    }
    if (s.angleJitter > 0) angle += rng.signed() * 180 * (s.angleJitter / 100);
    if (s.roundnessJitter > 0) roundness = Math.max(0.05, roundness * (1 - (s.roundnessJitter / 100) * rng.next()));
  }
  let opacity = 1;
  let flow = 1;
  if (s.transfer) {
    if (s.opacityJitter > 0) opacity = 1 - (s.opacityJitter / 100) * rng.next();
    if (s.flowJitter > 0) flow = 1 - (s.flowJitter / 100) * rng.next();
    if (s.pressureOpacity && pointerType === "pen") opacity *= Math.max(0.02, Math.min(1, pressure));
  }
  void heading;
  return { x: p.x, y: p.y, size: Math.max(1, size), angle, roundness, opacity, flow };
}

/**
 * Advance a placement from `state.last` to `to` and return the dabs to stamp. Scatter
 * offsets dabs perpendicular to travel (or in both axes); `count` stamps several per
 * step. `from` itself is never re-stamped; the first call stamps `to` once.
 */
export function placeDabs(
  to: Point,
  s: BrushSettings,
  state: PlacementState,
  rng: Rng,
  opts: { pressure?: number; pointerType?: string; diameter?: number } = {},
): Dab[] {
  const pressure = opts.pressure ?? 0.5;
  const pointerType = opts.pointerType ?? "mouse";
  const base = pressureDiameter(opts.diameter ?? s.size, pressure, pointerType, s.pressureSize, s.shapeDynamics ? s.minDiameter : 0);
  const out: Dab[] = [];
  const emit = (p: Point): void => {
    const n = s.scattering ? Math.max(1, Math.round(s.count * (1 - (s.countJitter / 100) * rng.next()))) : 1;
    for (let k = 0; k < n; k++) {
      let q = p;
      if (s.scattering && s.scatter > 0) {
        const amt = (s.scatter / 100) * base;
        const h = (state.heading * Math.PI) / 180;
        const px = -Math.sin(h);
        const py = Math.cos(h);
        const o = rng.signed() * amt;
        if (s.scatterBoth) {
          const o2 = rng.signed() * amt;
          q = { x: p.x + px * o + Math.cos(h) * o2, y: p.y + py * o + Math.sin(h) * o2 };
        } else q = { x: p.x + px * o, y: p.y + py * o };
      }
      out.push(makeDab(q, base, s, rng, pressure, pointerType, state.heading));
    }
  };
  if (!state.last) {
    state.last = { x: to.x, y: to.y };
    state.carry = 0;
    emit(to);
    return out;
  }
  const from = state.last;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    if (s.buildUp) emit(to);
    return out;
  }
  state.heading = (Math.atan2(dy, dx) * 180) / Math.PI;
  const step = spacingPx(base, s.spacing);
  let d = step - state.carry;
  while (d <= len) {
    const t = d / len;
    emit({ x: from.x + dx * t, y: from.y + dy * t });
    d += step;
  }
  state.carry = out.length === 0 && d > len ? state.carry + len : len - (d - step);
  state.last = { x: to.x, y: to.y };
  return out;
}

/**
 * Pull-string smoothing: the pen only moves when the string between it and the pointer
 * is taut. `length` px = string length (PS: smoothing % × a size-based factor).
 */
export function pullString(pen: Point, pointer: Point, length: number): Point {
  const dx = pointer.x - pen.x;
  const dy = pointer.y - pen.y;
  const d = Math.hypot(dx, dy);
  if (d <= length || d === 0) return pen;
  const k = (d - length) / d;
  return { x: pen.x + dx * k, y: pen.y + dy * k };
}

/** String length for a smoothing percentage (0 → 0, 100 → ~1 diameter + 30 px). */
export function smoothingLength(smoothingPct: number, diameter: number): number {
  if (smoothingPct <= 0) return 0;
  return (smoothingPct / 100) * (diameter * 0.75 + 30);
}

/** Snap a point to the line from `anchor` constrained to 0/45/90 degree angles (Shift). */
export function constrainAngle(anchor: Point, p: Point): Point {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const ang = Math.atan2(dy, dx);
  const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: anchor.x + Math.cos(snapped) * len, y: anchor.y + Math.sin(snapped) * len };
}

// ---------------------------------------------------------------------------
// Dab masks
// ---------------------------------------------------------------------------

/**
 * Coverage (0..1) of a round dab at distance `dist` from its centre. `hardness` 0..1:
 * 1 = hard edge (anti-aliased over ~1px), 0 = smooth fade from the centre.
 */
export function roundCoverage(dist: number, radius: number, hardness: number): number {
  if (radius <= 0) return 0;
  const h = Math.max(0, Math.min(1, hardness));
  const inner = Math.max(0, Math.min(radius - 0.75, radius * h));
  if (dist <= inner) return 1;
  if (dist >= radius) return 0;
  const t = (dist - inner) / Math.max(1e-6, radius - inner);
  return 0.5 + 0.5 * Math.cos(t * Math.PI);
}

export interface DabMask {
  /** Pixel size of the square mask. */
  n: number;
  /** Offset of the mask's top-left from the dab centre (= -n/2). */
  half: number;
  cov: Float32Array;
}

/**
 * Render a dab mask for a tip at `size` px with `angle` (deg) / `roundness` (0..1) /
 * `hardness` (0..1, round tip only). `aliased` thresholds coverage (Pencil).
 */
export function renderDabMask(tip: BrushTip, size: number, angle: number, roundness: number, hardness: number, opts: { aliased?: boolean; flipX?: boolean; flipY?: boolean } = {}): DabMask {
  const n = Math.max(1, Math.ceil(size) + 2);
  const half = n / 2;
  const cov = new Float32Array(n * n);
  const r = size / 2;
  const ry = Math.max(0.02, roundness);
  const rad = (-angle * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const fx = opts.flipX ? -1 : 1;
  const fy = opts.flipY ? -1 : 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = x + 0.5 - half;
      const py = y + 0.5 - half;
      // Inverse rotate, then un-squash the ellipse.
      const ux = (px * ca - py * sa) * fx;
      const uy = ((px * sa + py * ca) / ry) * fy;
      let a: number;
      if (tip.kind === "round") {
        a = roundCoverage(Math.hypot(ux, uy), r, hardness);
      } else {
        const tx = (ux / size + 0.5) * TIP_SIZE;
        const ty = (uy / size + 0.5) * TIP_SIZE;
        a = tx < 0 || ty < 0 || tx >= TIP_SIZE || ty >= TIP_SIZE ? 0 : sampleTip(tip, tx, ty);
        // Soften the ellipse clip so squashed tips keep anti-aliased edges.
        if (size < 8) a *= Math.min(1, size / 8) + (1 - Math.min(1, size / 8)) * (Math.hypot(ux, uy) < r ? 1 : 0);
      }
      if (opts.aliased) a = a >= 0.5 ? 1 : 0;
      cov[y * n + x] = a;
    }
  }
  return { n, half, cov };
}

/** Small LRU-ish cache keyed on quantised dab parameters. */
export class DabMaskCache {
  private map = new Map<string, DabMask>();
  get(tip: BrushTip, size: number, angle: number, roundness: number, hardness: number, aliased: boolean, flipX: boolean, flipY: boolean): DabMask {
    const qs = Math.round(size * 2) / 2;
    const qa = Math.round(angle / 2) * 2;
    const qr = Math.round(roundness * 50) / 50;
    const qh = Math.round(hardness * 20) / 20;
    const key = `${tip.id}|${qs}|${qa}|${qr}|${qh}|${aliased ? 1 : 0}|${flipX ? 1 : 0}${flipY ? 1 : 0}`;
    let m = this.map.get(key);
    if (!m) {
      m = renderDabMask(tip, qs, qa, qr, qh, { aliased, flipX, flipY });
      if (this.map.size > 64) this.map.delete(this.map.keys().next().value!);
      this.map.set(key, m);
    }
    return m;
  }
}

// ---------------------------------------------------------------------------
// Stroke
// ---------------------------------------------------------------------------

export type StrokeBlend =
  | { mode: "color"; color: RGBA }
  | { mode: "erase" }
  | { mode: "source"; sourceAt: (x: number, y: number, out: RGBA) => void }
  | { mode: "target"; computeTarget: (before: Raster, rect: Rect) => Raster; margin: number }
  | { mode: "smudge"; strength: number; fingerColor: RGBA | null };

export interface StrokeOptions {
  settings: BrushSettings;
  blend: StrokeBlend;
  /** 0..1 */
  opacity: number;
  /** 0..1 */
  flow: number;
  /** Document selection clip (or null). */
  selection: Selection | null;
  /** Document offset of the target raster. */
  offset: Point;
  /** Pencil: aliased dabs. */
  aliased?: boolean;
  seed?: number;
  /** Diameter override (options bar size) — defaults to settings.size. */
  diameter?: number;
  /** Hardness override 0..100. */
  hardness?: number;
}

/** A stroke in progress on a raster. */
export class BrushStroke {
  readonly raster: Raster;
  readonly before: Raster;
  private readonly cov: Float32Array;
  private readonly w: number;
  private readonly h: number;
  private dirty: Rect | null = null;
  private readonly opts: StrokeOptions;
  private readonly rng: Rng;
  private readonly tip: BrushTip;
  private readonly masks = new DabMaskCache();
  private readonly placement: PlacementState = { carry: 0, last: null, heading: 0 };
  private pen: Point | null = null;
  private targetCache: { rect: Rect; raster: Raster } | null = null;
  private finger: Float32Array | null = null;
  private fingerN = 0;
  readonly fingerStart: RGBA | null;

  constructor(raster: Raster, opts: StrokeOptions) {
    this.raster = raster;
    this.before = raster.clone();
    this.w = raster.width;
    this.h = raster.height;
    this.cov = new Float32Array(this.w * this.h);
    this.opts = opts;
    this.rng = new Rng(opts.seed ?? randomSeed());
    this.tip = tipById(opts.settings.tip) ?? ROUND_TIP;
    this.fingerStart = opts.blend.mode === "smudge" ? opts.blend.fingerColor : null;
  }

  get dirtyRect(): Rect | null {
    return this.dirty;
  }

  get settings(): BrushSettings {
    return this.opts.settings;
  }

  /** Current pen position after smoothing (for the cursor outline). */
  get penPosition(): Point | null {
    return this.pen;
  }

  /**
   * Advance the stroke to pointer position `p` (raster space). Returns the raster rect
   * touched by this call (for `markDirty`), or null.
   */
  moveTo(p: Point, input: { pressure?: number; pointerType?: string } = {}): Rect | null {
    const s = this.opts.settings;
    const diameter = this.opts.diameter ?? s.size;
    let target = p;
    if (s.smoothing > 0) {
      if (!this.pen) this.pen = { x: p.x, y: p.y };
      else this.pen = pullString(this.pen, p, smoothingLength(s.smoothing, diameter));
      target = this.pen;
    } else this.pen = p;
    const popts: { pressure?: number; pointerType?: string; diameter?: number } = { diameter };
    if (input.pressure !== undefined) popts.pressure = input.pressure;
    if (input.pointerType !== undefined) popts.pointerType = input.pointerType;
    const dabs = placeDabs(target, s, this.placement, this.rng, popts);
    let touched: Rect | null = null;
    for (const d of dabs) touched = Rect.union(touched, this.stamp(d));
    if (touched) this.dirty = Rect.union(this.dirty, touched);
    return touched;
  }

  /** Finish a smoothed stroke: let the pen catch up to the last pointer position. */
  catchUp(p: Point, input: { pressure?: number; pointerType?: string } = {}): Rect | null {
    if (this.opts.settings.smoothing <= 0) return null;
    this.pen = { x: p.x, y: p.y };
    const opts: { pressure?: number; pointerType?: string; diameter?: number } = { diameter: this.opts.diameter ?? this.opts.settings.size };
    if (input.pressure !== undefined) opts.pressure = input.pressure;
    if (input.pointerType !== undefined) opts.pointerType = input.pointerType;
    const dabs = placeDabs(p, this.opts.settings, this.placement, this.rng, opts);
    let touched: Rect | null = null;
    for (const d of dabs) touched = Rect.union(touched, this.stamp(d));
    if (touched) this.dirty = Rect.union(this.dirty, touched);
    return touched;
  }

  /** Stamp one dab: accumulate coverage then re-composite its rect. */
  stamp(d: Dab): Rect | null {
    const s = this.opts.settings;
    const hardness = (this.opts.hardness ?? s.hardness) / 100;
    const m = this.masks.get(this.tip, d.size, d.angle, d.roundness, hardness, this.opts.aliased ?? false, s.flipX, s.flipY);
    const x0 = Math.round(d.x - m.half);
    const y0 = Math.round(d.y - m.half);
    const rx0 = Math.max(0, x0);
    const ry0 = Math.max(0, y0);
    const rx1 = Math.min(this.w, x0 + m.n);
    const ry1 = Math.min(this.h, y0 + m.n);
    if (rx1 <= rx0 || ry1 <= ry0) return null;
    const rect = Rect.make(rx0, ry0, rx1 - rx0, ry1 - ry0);
    if (this.opts.blend.mode === "smudge") {
      this.smudge(d, m, x0, y0, rect);
      return rect;
    }
    const flow = this.opts.flow * d.flow;
    const sel = this.opts.selection && !this.opts.selection.isEmpty ? this.opts.selection : null;
    const off = this.opts.offset;
    const cov = this.cov;
    const w = this.w;
    const buildUp = s.buildUp;
    for (let y = ry0; y < ry1; y++) {
      const my = (y - y0) * m.n;
      for (let x = rx0; x < rx1; x++) {
        let a = m.cov[my + (x - x0)]! * flow * d.opacity;
        if (a <= 0) continue;
        if (sel) {
          a *= sel.get(x + off.x, y + off.y) / 255;
          if (a <= 0) continue;
        }
        const i = y * w + x;
        const c = cov[i]!;
        cov[i] = buildUp ? Math.min(1, c + a) : c + a * (1 - c);
      }
    }
    this.composite(rect);
    return rect;
  }

  /** Recompute raster pixels inside `rect` from the snapshot, coverage and blend. */
  private composite(rect: Rect): void {
    const blend = this.opts.blend;
    const opacity = this.opts.opacity;
    const dst = this.raster.data;
    const src = this.before.data;
    const cov = this.cov;
    const w = this.w;
    const px = { r: 0, g: 0, b: 0, a: 0 };
    let target: Raster | null = null;
    let tRect: Rect | null = null;
    if (blend.mode === "target") {
      const t = this.targetFor(rect, blend);
      target = t.raster;
      tRect = t.rect;
    }
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = y * w + x;
        const a = Math.min(1, cov[i]!) * opacity;
        const p = i * 4;
        const br = src[p]!;
        const bg = src[p + 1]!;
        const bb = src[p + 2]!;
        const ba = src[p + 3]! / 255;
        if (a <= 0) {
          dst[p] = br;
          dst[p + 1] = bg;
          dst[p + 2] = bb;
          dst[p + 3] = src[p + 3]!;
          continue;
        }
        if (blend.mode === "erase") {
          dst[p] = br;
          dst[p + 1] = bg;
          dst[p + 2] = bb;
          dst[p + 3] = ba * (1 - a) * 255;
          continue;
        }
        if (blend.mode === "target" && target && tRect) {
          const q = ((y - tRect.y) * tRect.w + (x - tRect.x)) * 4;
          const td = target.data;
          // Straight lerp between snapshot and target (target may change alpha: background eraser).
          const ta = td[q + 3]! / 255;
          const oa = ba + (ta - ba) * a;
          if (oa <= 0) {
            dst[p] = br;
            dst[p + 1] = bg;
            dst[p + 2] = bb;
            dst[p + 3] = 0;
            continue;
          }
          const wb = (ba * (1 - a)) / oa;
          const wt = (ta * a) / oa;
          dst[p] = br * wb + td[q]! * wt;
          dst[p + 1] = bg * wb + td[q + 1]! * wt;
          dst[p + 2] = bb * wb + td[q + 2]! * wt;
          dst[p + 3] = oa * 255;
          continue;
        }
        let sr: number;
        let sg: number;
        let sb: number;
        let sa = a;
        if (blend.mode === "color") {
          sr = blend.color.r;
          sg = blend.color.g;
          sb = blend.color.b;
          sa = a * (blend.color.a / 255);
        } else if (blend.mode === "source") {
          blend.sourceAt(x, y, px);
          sr = px.r;
          sg = px.g;
          sb = px.b;
          sa = a * (px.a / 255);
        } else {
          sr = br;
          sg = bg;
          sb = bb;
        }
        if (sa <= 0) {
          dst[p] = br;
          dst[p + 1] = bg;
          dst[p + 2] = bb;
          dst[p + 3] = src[p + 3]!;
          continue;
        }
        const ao = sa + ba * (1 - sa);
        const ws = sa / ao;
        const wd = (ba * (1 - sa)) / ao;
        dst[p] = sr * ws + br * wd;
        dst[p + 1] = sg * ws + bg * wd;
        dst[p + 2] = sb * ws + bb * wd;
        dst[p + 3] = ao * 255;
      }
    }
  }

  /** Target raster covering `rect` (+ margin), computed from the snapshot and cached per stroke region. */
  private targetFor(rect: Rect, blend: Extract<StrokeBlend, { mode: "target" }>): { rect: Rect; raster: Raster } {
    const want = Rect.intersect(Rect.inflate(rect, blend.margin), this.before.bounds());
    const c = this.targetCache;
    if (c && Rect.contains(c.rect, want)) return c;
    // Grow the cached region to cover both (bounded by the raster).
    const grow = Rect.intersect(Rect.inflate(Rect.union(c?.rect ?? null, want), blend.margin + 8), this.before.bounds());
    const raster = blend.computeTarget(this.before, grow);
    this.targetCache = { rect: grow, raster };
    return this.targetCache;
  }

  /** Smudge: pick up colour under the finger and drag it along. */
  private smudge(d: Dab, m: DabMask, x0: number, y0: number, rect: Rect): void {
    const blend = this.opts.blend as Extract<StrokeBlend, { mode: "smudge" }>;
    const n = m.n;
    const dst = this.raster.data;
    const w = this.w;
    const sel = this.opts.selection && !this.opts.selection.isEmpty ? this.opts.selection : null;
    const off = this.opts.offset;
    if (!this.finger || this.fingerN !== n) {
      // Initialise the finger from the pixels under the first dab (or the fg colour).
      this.finger = new Float32Array(n * n * 4);
      this.fingerN = n;
      const f = this.finger;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const q = (y * n + x) * 4;
          const sx = x0 + x;
          const sy = y0 + y;
          if (blend.fingerColor) {
            f[q] = blend.fingerColor.r;
            f[q + 1] = blend.fingerColor.g;
            f[q + 2] = blend.fingerColor.b;
            f[q + 3] = 255;
          } else if (sx >= 0 && sy >= 0 && sx < w && sy < this.h) {
            const p = (sy * w + sx) * 4;
            f[q] = dst[p]!;
            f[q + 1] = dst[p + 1]!;
            f[q + 2] = dst[p + 2]!;
            f[q + 3] = dst[p + 3]!;
          }
        }
      }
      if (!blend.fingerColor) return;
    }
    const f = this.finger;
    const k = blend.strength * this.opts.flow;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const mi = (y - y0) * n + (x - x0);
        let a = m.cov[mi]! * k * d.opacity;
        if (sel) a *= sel.get(x + off.x, y + off.y) / 255;
        const p = (y * w + x) * 4;
        const q = mi * 4;
        if (a > 0) {
          // Deposit: dst ← lerp(dst, finger, a) in premultiplied-ish space.
          const fa = f[q + 3]! / 255;
          const ba = dst[p + 3]! / 255;
          const oa = ba + (fa - ba) * a;
          if (oa > 0) {
            const wb = (ba * (1 - a)) / oa;
            const wf = (fa * a) / oa;
            dst[p] = dst[p]! * wb + f[q]! * wf;
            dst[p + 1] = dst[p + 1]! * wb + f[q + 1]! * wf;
            dst[p + 2] = dst[p + 2]! * wb + f[q + 2]! * wf;
          }
          dst[p + 3] = oa * 255;
        }
        // Pick up: the finger blends towards what is now under it.
        const pick = m.cov[mi]! * (1 - blend.strength) * 0.5 + 0.1;
        f[q] = f[q]! + (dst[p]! - f[q]!) * pick;
        f[q + 1] = f[q + 1]! + (dst[p + 1]! - f[q + 1]!) * pick;
        f[q + 2] = f[q + 2]! + (dst[p + 2]! - f[q + 2]!) * pick;
        f[q + 3] = f[q + 3]! + (dst[p + 3]! - f[q + 3]!) * pick;
      }
    }
  }

  /** Drop the cached target region (continuous sampling changed the op's parameters). */
  invalidateTarget(): void {
    this.targetCache = null;
  }

  /** Coverage 0..1 at a raster pixel (tests / healing post-process). */
  coverageAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return Math.min(1, this.cov[y * this.w + x]!);
  }

  /** The coverage buffer (raster-sized floats). */
  get coverage(): Float32Array {
    return this.cov;
  }

  /** Restore the snapshot inside the dirty rect (Esc). Returns the rect to mark dirty. */
  abort(): Rect | null {
    if (!this.dirty) return null;
    this.raster.blit(this.before, this.dirty.x, this.dirty.y, this.dirty, { mode: "replace" });
    return this.dirty;
  }
}

/** Luminance 0..255 used when painting masks with a colour. */
export function maskGray(c: RGBA): RGBA {
  const v = Math.round(0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
  return { r: v, g: v, b: v, a: 255 };
}
