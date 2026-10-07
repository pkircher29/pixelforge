import { describe, expect, it } from "vitest";
import { Raster, Rect, Selection } from "../../lib/engine";
import {
  BrushStroke,
  DEFAULT_BRUSH_SETTINGS,
  makeDab,
  normalizeBrushSettings,
  placeDabs,
  pressureDiameter,
  pullString,
  renderDabMask,
  roundCoverage,
  smoothingLength,
  spacingPx,
  type BrushSettings,
  type PlacementState,
} from "../../lib/tools/brush-engine";
import { builtinTips, sampleTip, tipById, tipFromRaster, TIP_SIZE } from "../../lib/tools/brush-tips";
import { Rng } from "../../lib/tools/rng";
import { BUILTIN_PRESETS, PRESET_GROUPS } from "../../lib/tools/brush-presets";

const S = (over: Partial<BrushSettings> = {}): BrushSettings => ({ ...DEFAULT_BRUSH_SETTINGS, ...over });
const fresh = (): PlacementState => ({ carry: 0, last: null, heading: 0 });

describe("seeded RNG", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const xs = Array.from({ length: 50 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Rng(43).next()).not.toBe(xs[0]);
  });
});

describe("dab placement", () => {
  it("stamps the first point once, then every spacing px", () => {
    const st = fresh();
    const rng = new Rng(1);
    const s = S({ size: 40, spacing: 25 });
    expect(placeDabs({ x: 0, y: 0 }, s, st, rng)).toHaveLength(1);
    const d = placeDabs({ x: 35, y: 0 }, s, st, rng);
    expect(d.map((x) => x.x)).toEqual([10, 20, 30]);
    expect(st.carry).toBeCloseTo(5);
    const d2 = placeDabs({ x: 41, y: 0 }, s, st, rng);
    expect(d2.map((x) => x.x)).toEqual([40]);
  });

  it("spacing is a % of the diameter with a floor", () => {
    expect(spacingPx(40, 25)).toBe(10);
    expect(spacingPx(1, 10)).toBe(0.5);
  });

  it("jitter is deterministic for a seed and stays within bounds", () => {
    const s = S({ size: 50, shapeDynamics: true, sizeJitter: 100, minDiameter: 20, angleJitter: 100 });
    const run = (seed: number) => {
      const st = fresh();
      const rng = new Rng(seed);
      placeDabs({ x: 0, y: 0 }, s, st, rng);
      return placeDabs({ x: 200, y: 0 }, s, st, rng);
    };
    const a = run(7);
    expect(run(7)).toEqual(a);
    expect(a.every((d) => d.size >= 50 * 0.2 - 1e-9 && d.size <= 50)).toBe(true);
    expect(new Set(a.map((d) => Math.round(d.size))).size).toBeGreaterThan(1);
    expect(a.every((d) => d.angle >= -180 && d.angle <= 180)).toBe(true);
  });

  it("scatter offsets dabs perpendicular to travel and count multiplies them", () => {
    const s = S({ size: 20, spacing: 50, scattering: true, scatter: 200, count: 3 });
    const st = fresh();
    const rng = new Rng(3);
    placeDabs({ x: 0, y: 100 }, s, st, rng);
    const d = placeDabs({ x: 100, y: 100 }, s, st, rng);
    expect(d.length).toBe(10 * 3);
    expect(d.some((p) => Math.abs(p.y - 100) > 1)).toBe(true);
    expect(d.every((p) => Math.abs(p.y - 100) <= 40 + 1e-9)).toBe(true);
  });

  it("transfer jitter lowers opacity/flow; pressure scales size for pens only", () => {
    const s = S({ transfer: true, opacityJitter: 100, flowJitter: 100 });
    const d = makeDab({ x: 0, y: 0 }, 30, s, new Rng(9), 0.5, "mouse", 0);
    expect(d.opacity).toBeLessThanOrEqual(1);
    expect(d.flow).toBeLessThanOrEqual(1);
    expect(pressureDiameter(100, 0.5, "pen", true)).toBe(50);
    expect(pressureDiameter(100, 0.5, "mouse", true)).toBe(100);
    expect(pressureDiameter(100, 0, "pen", true, 25)).toBe(25);
  });

  it("build-up stamps again when the pointer rests", () => {
    const st = fresh();
    const s = S({ buildUp: true });
    placeDabs({ x: 5, y: 5 }, s, st, new Rng(1));
    expect(placeDabs({ x: 5, y: 5 }, s, st, new Rng(1))).toHaveLength(1);
    expect(placeDabs({ x: 5, y: 5 }, S(), { carry: 0, last: { x: 5, y: 5 }, heading: 0 }, new Rng(1))).toHaveLength(0);
  });

  it("normalizes out-of-range settings", () => {
    const n = normalizeBrushSettings({ size: 0, roundness: 500, count: 99, hardness: -3 });
    expect(n.size).toBe(1);
    expect(n.roundness).toBe(100);
    expect(n.count).toBe(16);
    expect(n.hardness).toBe(0);
  });
});

describe("smoothing (pull string)", () => {
  it("the pen stays put while the string is slack and follows when taut", () => {
    expect(pullString({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toEqual({ x: 0, y: 0 });
    const p = pullString({ x: 0, y: 0 }, { x: 30, y: 0 }, 10);
    expect(p.x).toBeCloseTo(20);
    expect(smoothingLength(0, 50)).toBe(0);
    expect(smoothingLength(100, 40)).toBeGreaterThan(smoothingLength(50, 40));
  });

  it("a smoothed stroke lags behind the pointer and catches up on release", () => {
    const r = new Raster(120, 20);
    const st = new BrushStroke(r, { settings: S({ size: 4, hardness: 100, smoothing: 100 }), blend: { mode: "color", color: { r: 255, g: 0, b: 0, a: 255 } }, opacity: 1, flow: 1, selection: null, offset: { x: 0, y: 0 }, seed: 1 });
    st.moveTo({ x: 5, y: 10 });
    st.moveTo({ x: 100, y: 10 });
    expect(r.getPixel(100, 10).a).toBe(0);
    st.catchUp({ x: 100, y: 10 });
    expect(r.getPixel(100, 10).a).toBeGreaterThan(0);
  });
});

describe("dab masks and tips", () => {
  it("round coverage: hard inside, soft falls off", () => {
    expect(roundCoverage(0, 10, 1)).toBe(1);
    expect(roundCoverage(11, 10, 1)).toBe(0);
    expect(roundCoverage(5, 10, 0)).toBeCloseTo(0.5, 1);
  });

  it("roundness squashes the mask along y; angle rotates it", () => {
    const tip = tipById("round");
    const m = renderDabMask(tip, 40, 0, 0.25, 1);
    const at = (x: number, y: number) => m.cov[Math.floor(y + m.half) * m.n + Math.floor(x + m.half)]!;
    expect(at(15, 0)).toBeGreaterThan(0.9);
    expect(at(0, 15)).toBe(0);
    const r = renderDabMask(tip, 40, 90, 0.25, 1);
    const at2 = (x: number, y: number) => r.cov[Math.floor(y + r.half) * r.n + Math.floor(x + r.half)]!;
    expect(at2(0, 15)).toBeGreaterThan(0.9);
    expect(at2(15, 0)).toBe(0);
  });

  it("aliased (pencil) masks are binary", () => {
    const m = renderDabMask(tipById("round"), 9, 0, 1, 0.3, { aliased: true });
    expect([...m.cov].every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("ships ≥12 procedural tips, deterministic and non-empty", () => {
    const tips = builtinTips();
    expect(tips.length).toBeGreaterThanOrEqual(12);
    for (const t of tips.filter((x) => x.kind === "custom")) {
      const d = t.raster!.data;
      let sum = 0;
      for (let i = 3; i < d.length; i += 4) sum += d[i]!;
      expect(sum, t.id).toBeGreaterThan(0);
      expect(t.raster!.width).toBe(TIP_SIZE);
    }
  });

  it("custom tip sampling is bilinear and zero outside", () => {
    const sq = tipById("square");
    expect(sampleTip(sq, TIP_SIZE / 2, TIP_SIZE / 2)).toBeCloseTo(1);
    expect(sampleTip(sq, -5, -5)).toBe(0);
    const src = new Raster(8, 8);
    src.fill({ r: 255, g: 255, b: 255, a: 255 });
    src.fill({ r: 0, g: 0, b: 0, a: 255 }, Rect.make(0, 0, 4, 8));
    const t = tipFromRaster("test-png", "Half", src);
    expect(sampleTip(t, 8, 32)).toBeGreaterThan(0.9);
    expect(sampleTip(t, 56, 32)).toBeLessThan(0.1);
    expect(tipById("test-png")).toBe(t);
  });
});

describe("BrushStroke", () => {
  const color = { mode: "color" as const, color: { r: 0, g: 0, b: 255, a: 255 } };
  const base = { opacity: 1, flow: 1, selection: null, offset: { x: 0, y: 0 }, seed: 5 };

  it("opacity caps accumulation across overlapping dabs", () => {
    const r = new Raster(40, 20);
    const s = new BrushStroke(r, { ...base, settings: S({ size: 10, hardness: 100 }), blend: color, opacity: 0.5 });
    for (let x = 8; x < 14; x++) s.moveTo({ x, y: 10 });
    const a = r.getPixel(11, 10).a;
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThanOrEqual(128);
  });

  it("erase / source / target blends and the selection clip", () => {
    const r = Raster.filled(30, 30, { r: 10, g: 20, b: 30, a: 255 });
    const sel = Selection.fromRect(30, 30, Rect.make(0, 0, 15, 30));
    const e = new BrushStroke(r, { ...base, settings: S({ size: 12, hardness: 100 }), blend: { mode: "erase" }, selection: sel });
    e.moveTo({ x: 15, y: 15 });
    expect(r.getPixel(12, 15).a).toBe(0);
    expect(r.getPixel(18, 15).a).toBe(255);
    const r2 = new Raster(20, 20);
    const src = Raster.filled(20, 20, { r: 9, g: 8, b: 7, a: 255 });
    new BrushStroke(r2, { ...base, settings: S({ size: 6, hardness: 100 }), blend: { mode: "source", sourceAt: (x, y, out) => src.getPixel(x, y, out) } }).moveTo({ x: 10, y: 10 });
    expect(r2.getPixel(10, 10)).toEqual({ r: 9, g: 8, b: 7, a: 255 });
    const r3 = Raster.filled(20, 20, { r: 100, g: 100, b: 100, a: 255 });
    new BrushStroke(r3, { ...base, settings: S({ size: 8, hardness: 100 }), blend: { mode: "target", margin: 0, computeTarget: (b, rect) => { const o = b.crop(rect); o.fill({ r: 200, g: 0, b: 0, a: 255 }); return o; } } }).moveTo({ x: 10, y: 10 });
    expect(r3.getPixel(10, 10).r).toBe(200);
    expect(r3.getPixel(1, 1).r).toBe(100);
  });

  it("same seed → identical pixels (jittered, scattered stroke)", () => {
    const paint = () => {
      const r = new Raster(64, 64);
      const s = new BrushStroke(r, { ...base, settings: S({ size: 10, tip: "spatter", scattering: true, scatter: 150, count: 2, shapeDynamics: true, sizeJitter: 50, angleJitter: 100 }), blend: color });
      for (let i = 0; i <= 20; i++) s.moveTo({ x: 5 + i * 2.7, y: 32 + Math.sin(i) * 10 });
      return r.data;
    };
    expect(Array.from(paint())).toEqual(Array.from(paint()));
  });

  it("abort restores the snapshot inside the dirty rect", () => {
    const r = Raster.filled(20, 20, { r: 1, g: 2, b: 3, a: 255 });
    const s = new BrushStroke(r, { ...base, settings: S({ size: 8 }), blend: color });
    s.moveTo({ x: 10, y: 10 });
    s.abort();
    expect(r.getPixel(10, 10)).toEqual({ r: 1, g: 2, b: 3, a: 255 });
  });

  it("smudge drags colour along the stroke", () => {
    const r = new Raster(40, 10);
    r.fill({ r: 255, g: 0, b: 0, a: 255 }, Rect.make(0, 0, 10, 10));
    r.fill({ r: 0, g: 0, b: 255, a: 255 }, Rect.make(10, 0, 30, 10));
    const s = new BrushStroke(r, { ...base, settings: S({ size: 8, hardness: 100, spacing: 10 }), blend: { mode: "smudge", strength: 0.8, fingerColor: null } });
    for (let x = 4; x <= 24; x += 1) s.moveTo({ x, y: 5 });
    expect(r.getPixel(16, 5).r).toBeGreaterThan(40);
  });
});

describe("brush presets", () => {
  it("ships ~30 presets in groups with valid tips and unique ids", () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
    expect(PRESET_GROUPS.length).toBeGreaterThanOrEqual(4);
    const tipIds = new Set(builtinTips().map((t) => t.id));
    for (const p of BUILTIN_PRESETS) expect(tipIds.has(p.settings.tip), p.id).toBe(true);
  });
});
