import { describe, expect, it } from "vitest";
import { Raster, Rect } from "../../lib/engine";
import { featherMask, findHealSource, healRegion, maskBounds, regionStats, ringMask } from "../../lib/tools/heal";
import {
  backgroundEraseWeight,
  boxBlurRegion,
  dodgeBurn,
  fixRedEye,
  isRedEyePixel,
  rangeWeight,
  replaceColor,
  sharpenRegion,
  sponge,
} from "../../lib/tools/retouch-math";
import { redBlob } from "../../lib/tools/healing";
import { Rng } from "../../lib/tools/rng";

function discMask(w: number, h: number, cx: number, cy: number, r: number): Float32Array {
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) m[y * w + x] = 1;
  return m;
}

/** Noise texture with a given mean / spread per channel. */
function noise(w: number, h: number, mean: number, spread: number, seed = 1): Raster {
  const r = new Raster(w, h);
  const rng = new Rng(seed);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, mean + rng.signed() * spread));
    r.data[i * 4] = v;
    r.data[i * 4 + 1] = v;
    r.data[i * 4 + 2] = v;
    r.data[i * 4 + 3] = 255;
  }
  return r;
}

describe("healing blend (Poisson-lite)", () => {
  it("regionStats computes weighted mean and std", () => {
    const r = new Raster(4, 1);
    [0, 0, 100, 100].forEach((v, i) => r.setPixel(i, 0, { r: v, g: v, b: v, a: 255 }));
    const s = regionStats(r, Rect.make(0, 0, 4, 1), () => 1);
    expect(s.mean[0]).toBeCloseTo(50);
    expect(s.std[0]).toBeCloseTo(50);
  });

  it("ringMask is a band just outside the hole; maskBounds finds the hole", () => {
    const m = discMask(40, 40, 20, 20, 5);
    const b = maskBounds(m, 40, 40)!;
    expect(b.w).toBeGreaterThanOrEqual(9);
    const ring = ringMask(m, 40, 40, b, 3);
    expect(ring[20 * 40 + 20]).toBe(0);
    expect(ring[20 * 40 + 27]).toBe(1);
    expect(ring[20 * 40 + 35]).toBe(0);
  });

  it("matches the clone's mean and variance to the destination ring", () => {
    // Destination: dark low-contrast texture with a bright hole. Source: bright high-contrast texture.
    const w = 80;
    const h = 40;
    const dst = new Raster(w, h);
    dst.blit(noise(40, 40, 60, 8, 2), 0, 0, undefined, { mode: "replace" });
    dst.blit(noise(40, 40, 180, 40, 3), 40, 0, undefined, { mode: "replace" });
    dst.fill({ r: 255, g: 255, b: 255, a: 255 }, Rect.make(15, 15, 10, 10));
    const mask = new Float32Array(w * h);
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) mask[y * w + x] = 1;
    const src = dst.clone();
    healRegion(dst, src, mask, { x: 40, y: 0 }, { feather: 0 });
    const healed = regionStats(dst, Rect.make(16, 16, 8, 8), () => 1);
    expect(healed.mean[0]).toBeGreaterThan(45);
    expect(healed.mean[0]).toBeLessThan(75);
    expect(healed.std[0]).toBeLessThan(20);
    // Replace mode clones without matching.
    const dst2 = src.clone();
    healRegion(dst2, src, mask, { x: 40, y: 0 }, { mode: "replace", feather: 0 });
    expect(regionStats(dst2, Rect.make(16, 16, 8, 8), () => 1).mean[0]).toBeGreaterThan(140);
  });

  it("spot-heal source search prefers texture that matches the surroundings", () => {
    const w = 120;
    const h = 60;
    const r = noise(w, h, 90, 10, 4);
    // A very different region to the right; the matching texture is everywhere else.
    r.fill({ r: 250, g: 20, b: 20, a: 255 }, Rect.make(78, 0, 42, 60));
    r.fill({ r: 0, g: 0, b: 0, a: 255 }, Rect.make(26, 26, 8, 8));
    const mask = new Float32Array(w * h);
    for (let y = 26; y < 34; y++) for (let x = 26; x < 34; x++) mask[y * w + x] = 1;
    const b = maskBounds(mask, w, h)!;
    const off = findHealSource(r, mask, b, ringMask(mask, w, h, b, 3));
    expect(off.x !== 0 || off.y !== 0).toBe(true);
    expect(26 + off.x + 8).toBeLessThanOrEqual(78);
  });

  it("featherMask softens the edge but keeps the centre", () => {
    const m = discMask(30, 30, 15, 15, 6);
    const f = featherMask(m, 30, 30, Rect.make(8, 8, 14, 14), 2);
    expect(f[15 * 30 + 15]).toBeCloseTo(1);
    expect(f[15 * 30 + 21]!).toBeGreaterThan(0);
    expect(f[15 * 30 + 21]!).toBeLessThan(1);
  });
});

describe("dodge / burn / sponge / colour replacement math", () => {
  const mid = { r: 128, g: 100, b: 80, a: 255 };

  it("tonal range weights peak in their range", () => {
    expect(rangeWeight("shadows", 0.05)).toBeGreaterThan(rangeWeight("shadows", 0.8));
    expect(rangeWeight("highlights", 0.95)).toBeGreaterThan(rangeWeight("highlights", 0.2));
    expect(rangeWeight("midtones", 0.5)).toBeGreaterThan(rangeWeight("midtones", 0.05));
  });

  it("dodge lightens and burn darkens; protect tones keeps hue ratios", () => {
    const d = dodgeBurn(mid, "dodge", "midtones", 0.5, false);
    const b = dodgeBurn(mid, "burn", "midtones", 0.5, false);
    expect(d.r).toBeGreaterThan(mid.r);
    expect(b.r).toBeLessThan(mid.r);
    const p = dodgeBurn(mid, "dodge", "midtones", 0.5, true);
    expect(p.r / p.b).toBeCloseTo(mid.r / mid.b, 1);
    expect(dodgeBurn({ r: 250, g: 250, b: 250, a: 255 }, "dodge", "shadows", 1, false).r).toBeCloseTo(250, 0);
  });

  it("sponge desaturate → gray, saturate spreads channels", () => {
    const g = sponge(mid, "desaturate", 1, false);
    expect(Math.abs(g.r - g.b)).toBeLessThan(1);
    const s = sponge(mid, "saturate", 0.5, false);
    expect(s.r - s.b).toBeGreaterThan(mid.r - mid.b);
  });

  it("colour replacement keeps luminosity and takes the FG hue within tolerance", () => {
    const red = { r: 200, g: 40, b: 40, a: 255 };
    const out = replaceColor(red, red, { r: 0, g: 0, b: 255, a: 255 }, "color", 30, false);
    expect(out.b).toBeGreaterThan(out.r);
    expect(out.a).toBe(255);
    const green = { r: 30, g: 200, b: 30, a: 255 };
    expect(replaceColor(green, red, { r: 0, g: 0, b: 255, a: 255 }, "color", 10, false).a).toBe(0);
  });

  it("background eraser weight: erases similar, protects the foreground", () => {
    const bgc = { r: 255, g: 255, b: 255, a: 255 };
    expect(backgroundEraseWeight(250, 250, 250, bgc, 50, null)).toBe(1);
    expect(backgroundEraseWeight(10, 10, 10, bgc, 50, null)).toBe(0);
    expect(backgroundEraseWeight(250, 250, 250, bgc, 50, { r: 250, g: 250, b: 250, a: 255 })).toBe(0);
  });

  it("blur lowers contrast and sharpen raises it", () => {
    const r = new Raster(10, 1);
    for (let x = 0; x < 10; x++) r.setPixel(x, 0, x < 5 ? { r: 0, g: 0, b: 0, a: 255 } : { r: 255, g: 255, b: 255, a: 255 });
    const b = boxBlurRegion(r, Rect.make(0, 0, 10, 1), 2);
    expect(b.getPixel(4, 0).r).toBeGreaterThan(0);
    const s = sharpenRegion(r, Rect.make(0, 0, 10, 1), 1, 1);
    expect(s.getPixel(4, 0).r).toBe(0);
    expect(s.getPixel(5, 0).r).toBe(255);
  });

  it("red eye: detects a red blob and neutralises it", () => {
    expect(isRedEyePixel(220, 30, 40)).toBe(true);
    expect(isRedEyePixel(120, 110, 100)).toBe(false);
    const f = fixRedEye({ r: 220, g: 30, b: 40, a: 255 }, 0.5);
    expect(f.r).toBeLessThan(60);
    const r = Raster.filled(40, 40, { r: 200, g: 170, b: 150, a: 255 });
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (Math.hypot(x - 20, y - 20) < 5) r.setPixel(x, y, { r: 220, g: 20, b: 30, a: 255 });
    const blob = redBlob(r, 21, 20, 20)!;
    expect(blob).not.toBeNull();
    expect(blob.rect.w).toBeGreaterThanOrEqual(9);
    expect(redBlob(Raster.filled(20, 20, { r: 90, g: 90, b: 90, a: 255 }), 10, 10, 10)).toBeNull();
  });
});
