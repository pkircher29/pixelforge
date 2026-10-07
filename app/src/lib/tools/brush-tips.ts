/**
 * Brush tips: the round analytic tip plus ~12 procedural custom tips (alpha rasters)
 * generated deterministically with a seeded RNG — chalk, spatter, charcoal, grass…
 * Tips are 64×64 alpha-in-A rasters; the engine resamples them to the dab size with
 * angle / roundness applied. Users can also load a PNG as a tip (`tipFromRaster`).
 */
import { Raster } from "$lib/engine";
import { Rng } from "./rng";

export interface BrushTip {
  id: string;
  name: string;
  kind: "round" | "custom";
  /** Square alpha raster (A channel = coverage) for custom tips. */
  raster: Raster | null;
  /** Default spacing (%) PS ships with for this tip. */
  spacing: number;
}

export const TIP_SIZE = 64;

function makeTip(id: string, name: string, spacing: number, fn: (x: number, y: number, rng: Rng) => number, seed = 7): BrushTip {
  const r = new Raster(TIP_SIZE, TIP_SIZE);
  const rng = new Rng(seed);
  const d = r.data;
  for (let y = 0; y < TIP_SIZE; y++) {
    for (let x = 0; x < TIP_SIZE; x++) {
      // Normalised coordinates -1..1 (pixel centres).
      const u = ((x + 0.5) / TIP_SIZE) * 2 - 1;
      const v = ((y + 0.5) / TIP_SIZE) * 2 - 1;
      const a = Math.max(0, Math.min(1, fn(u, v, rng)));
      const i = (y * TIP_SIZE + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 0;
      d[i + 3] = Math.round(a * 255);
    }
  }
  return { id, name, kind: "custom", raster: r, spacing };
}

/** Cheap value noise in [0,1) on an integer lattice (deterministic). */
function vnoise(x: number, y: number, seed: number): number {
  const h = (ix: number, iy: number): number => {
    let n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const dd = h(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + dd) * sx * sy;
}

function fbm(x: number, y: number, seed: number, oct = 3): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * f, y * f, seed + i) * amp;
    f *= 2;
    amp *= 0.5;
  }
  return s;
}

const disc = (u: number, v: number, edge = 0.08): number => {
  const r = Math.hypot(u, v);
  return r >= 1 ? 0 : r <= 1 - edge ? 1 : (1 - r) / edge;
};

/** Spatter / grass style tips are built from random discs / blades. */
function spatter(seed: number, count: number, minR: number, maxR: number): (u: number, v: number) => number {
  const rng = new Rng(seed);
  const dots: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * 0.85;
    dots.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: rng.range(minR, maxR) });
  }
  return (u, v) => {
    let best = 0;
    for (const p of dots) {
      const dd = Math.hypot(u - p.x, v - p.y) / p.r;
      if (dd < 1) best = Math.max(best, dd < 0.7 ? 1 : (1 - dd) / 0.3);
    }
    return best;
  };
}

function grass(seed: number, blades: number): (u: number, v: number) => number {
  const rng = new Rng(seed);
  const segs: { x0: number; y0: number; x1: number; y1: number; w: number }[] = [];
  for (let i = 0; i < blades; i++) {
    const x0 = rng.signed() * 0.8;
    const lean = rng.signed() * 0.5;
    segs.push({ x0, y0: 0.95, x1: x0 + lean, y1: rng.range(-0.9, -0.2), w: rng.range(0.03, 0.07) });
  }
  return (u, v) => {
    let best = 0;
    for (const s of segs) {
      const dx = s.x1 - s.x0;
      const dy = s.y1 - s.y0;
      const l2 = dx * dx + dy * dy;
      let t = ((u - s.x0) * dx + (v - s.y0) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = s.x0 + dx * t;
      const py = s.y0 + dy * t;
      const dist = Math.hypot(u - px, v - py);
      const w = s.w * (1 - t * 0.7);
      if (dist < w) best = Math.max(best, 1 - dist / w);
    }
    return best;
  };
}

export const ROUND_TIP: BrushTip = { id: "round", name: "Round", kind: "round", raster: null, spacing: 25 };

let builtins: BrushTip[] | null = null;

/** The built-in tip library (generated once). */
export function builtinTips(): BrushTip[] {
  if (builtins) return builtins;
  const sp1 = spatter(11, 46, 0.05, 0.16);
  const sp2 = spatter(23, 140, 0.02, 0.07);
  const gr = grass(31, 14);
  builtins = [
    ROUND_TIP,
    makeTip("hard-round", "Hard Round", 25, (u, v) => disc(u, v, 0.04)),
    makeTip("soft-round", "Soft Round", 25, (u, v) => {
      const r = Math.hypot(u, v);
      return r >= 1 ? 0 : 0.5 + 0.5 * Math.cos(r * Math.PI);
    }),
    makeTip("square", "Square", 25, (u, v) => (Math.max(Math.abs(u), Math.abs(v)) < 0.92 ? 1 : 0)),
    makeTip("diamond", "Diamond", 25, (u, v) => (Math.abs(u) + Math.abs(v) < 0.95 ? 1 : 0)),
    makeTip("star", "Star", 30, (u, v) => {
      const a = Math.atan2(v, u);
      const r = Math.hypot(u, v);
      const k = 0.55 + 0.45 * Math.cos(5 * a);
      return r < 0.95 * k ? 1 : 0;
    }),
    makeTip("chalk", "Chalk", 10, (u, v) => {
      const base = disc(u, v, 0.12);
      const n = fbm(u * 6 + 3, v * 6 + 9, 5, 4);
      return base * (n > 0.42 ? 1 : n > 0.3 ? (n - 0.3) / 0.12 : 0);
    }),
    makeTip("charcoal", "Charcoal", 8, (u, v) => {
      const base = Math.abs(u) < 0.9 && Math.abs(v) < 0.55 ? 1 : 0;
      const n = fbm(u * 9 + 1, v * 14 + 2, 17, 3);
      return base * Math.max(0, Math.min(1, (n - 0.3) * 2.2));
    }),
    makeTip("dry-brush", "Dry Brush", 5, (u, v) => {
      const base = Math.abs(u) < 0.95 && Math.abs(v) < 0.6 ? 1 : 0;
      const streak = 0.5 + 0.5 * Math.sin(v * 27 + fbm(u * 3, v * 3, 29) * 6);
      const n = fbm(u * 5, v * 20, 41, 2);
      return base * (streak * n > 0.22 ? 1 : 0);
    }),
    makeTip("spatter", "Spatter", 20, (u, v) => sp1(u, v)),
    makeTip("fine-spatter", "Fine Spatter", 15, (u, v) => sp2(u, v)),
    makeTip("grass", "Grass", 40, (u, v) => gr(u, v)),
    makeTip("texture", "Rough Texture", 12, (u, v) => {
      const base = disc(u, v, 0.2);
      const n = fbm(u * 8 + 11, v * 8 + 5, 53, 4);
      return base * Math.max(0, Math.min(1, (n - 0.35) * 3));
    }),
    makeTip("triangle", "Triangle", 25, (u, v) => (v > -0.9 && Math.abs(u) < (v + 0.9) * 0.55 && v < 0.9 ? 1 : 0)),
  ];
  return builtins;
}

export function tipById(id: string): BrushTip {
  return builtinTips().find((t) => t.id === id) ?? userTips.get(id) ?? ROUND_TIP;
}

const userTips = new Map<string, BrushTip>();

/** Register a custom tip from a raster (PNG loaded by the user): luminance → alpha (dark = paint). */
export function tipFromRaster(id: string, name: string, src: Raster, spacing = 25): BrushTip {
  const size = TIP_SIZE;
  const r = src.resize(size, size, "bilinear");
  const d = r.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
    const a = (d[i + 3]! / 255) * (1 - lum);
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = Math.round(a * 255);
  }
  const tip: BrushTip = { id, name, kind: "custom", raster: r, spacing };
  userTips.set(id, tip);
  return tip;
}

export function allTips(): BrushTip[] {
  return [...builtinTips(), ...userTips.values()];
}

/**
 * Sample a custom tip's alpha (0..1) at tip-space coordinates `tx, ty` in 0..TIP_SIZE
 * (bilinear, zero outside).
 */
export function sampleTip(tip: BrushTip, tx: number, ty: number): number {
  const r = tip.raster;
  if (!r) return 0;
  const n = r.width;
  const x = tx - 0.5;
  const y = ty - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const d = r.data;
  const at = (ix: number, iy: number): number => (ix < 0 || iy < 0 || ix >= n || iy >= n ? 0 : d[(iy * n + ix) * 4 + 3]! / 255);
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const e = at(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
