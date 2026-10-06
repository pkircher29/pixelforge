import { describe, expect, it } from "vitest";
import { Raster, rgba } from "../../lib/engine";
import { defaultParams, type ParamValues } from "../../lib/filters/types";
import {
  addNoise,
  brightnessContrast,
  colorBalance,
  desaturate,
  exposure,
  gaussianBlur,
  hueSaturation,
  invert,
  levels,
  motionBlur,
  pixelate,
  posterize,
  sharpen,
  threshold,
  unsharpMask,
} from "../../lib/filters/ops";
import { blockAverage } from "../../lib/filters/ops/pixelate";
import { mulberry32 } from "../../lib/filters/random";

function px(r: Raster, x: number, y: number): [number, number, number, number] {
  const p = r.getPixel(x, y);
  return [p.r, p.g, p.b, p.a];
}

function solid(w: number, h: number, c: [number, number, number, number]): Raster {
  return Raster.filled(w, h, rgba(c[0], c[1], c[2], c[3]));
}

function noiseRaster(w: number, h: number, seed = 1): Raster {
  const r = new Raster(w, h);
  const rnd = mulberry32(seed);
  for (let i = 0; i < r.data.length; i += 4) {
    r.data[i] = rnd() * 255;
    r.data[i + 1] = rnd() * 255;
    r.data[i + 2] = rnd() * 255;
    r.data[i + 3] = 255;
  }
  return r;
}

function meanRgb(r: Raster): [number, number, number] {
  let a = 0;
  let b = 0;
  let c = 0;
  const n = r.width * r.height;
  for (let i = 0; i < r.data.length; i += 4) {
    a += r.data[i]!;
    b += r.data[i + 1]!;
    c += r.data[i + 2]!;
  }
  return [a / n, b / n, c / n];
}

const P = (op: { params: { id: string; default: unknown }[] }, over: ParamValues): ParamValues => ({
  ...defaultParams(op as never),
  ...over,
});

describe("point adjustments", () => {
  it("invert is exact and self-inverse, alpha untouched", () => {
    const src = solid(3, 2, [10, 200, 255, 128]);
    const out = invert.cpu(src, {});
    expect(px(out, 0, 0)).toEqual([245, 55, 0, 128]);
    expect(invert.cpu(out, {}).equals(src)).toBe(true);
  });

  it("threshold splits at the level on luma", () => {
    const src = new Raster(2, 1);
    src.setPixel(0, 0, rgba(100, 100, 100));
    src.setPixel(1, 0, rgba(200, 200, 200));
    const out = threshold.cpu(src, { level: 128 });
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(out, 1, 0)).toEqual([255, 255, 255, 255]);
    // Exactly at the level counts as white.
    const edge = threshold.cpu(solid(1, 1, [128, 128, 128, 255]), { level: 128 });
    expect(px(edge, 0, 0)[0]).toBe(255);
  });

  it("posterize with 2 levels yields pure black/white; 4 levels gives 0/85/170/255", () => {
    const src = new Raster(4, 1);
    src.setPixel(0, 0, rgba(0, 10, 120));
    src.setPixel(1, 0, rgba(130, 200, 255));
    const two = posterize.cpu(src, { levels: 2 });
    expect(px(two, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(two, 1, 0)).toEqual([255, 255, 255, 255]);
    const four = posterize.cpu(src, { levels: 4 });
    expect(px(four, 0, 0)).toEqual([0, 0, 85, 255]);
    expect(px(four, 1, 0)).toEqual([170, 255, 255, 255]);
  });

  it("brightness/contrast: defaults are identity; known values", () => {
    const src = solid(1, 1, [100, 128, 200, 255]);
    expect(brightnessContrast.cpu(src, P(brightnessContrast, {})).equals(src)).toBe(true);
    // +51 brightness adds 51.
    expect(px(brightnessContrast.cpu(src, { brightness: 51, contrast: 0 }), 0, 0)).toEqual([151, 179, 251, 255]);
    // -100 contrast collapses everything to mid grey.
    expect(px(brightnessContrast.cpu(src, { brightness: 0, contrast: -100 }), 0, 0)).toEqual([128, 128, 128, 255]);
    // +100 contrast = slope 4 around 127.5: 100 -> 17.5, 200 -> 255 (clamped), 128 -> 129.5.
    const hi = px(brightnessContrast.cpu(src, { brightness: 0, contrast: 100 }), 0, 0);
    expect([17, 18]).toContain(hi[0]); // exactly 17.5 before rounding
    expect(hi[1]).toBe(130);
    expect(hi[2]).toBe(255);
  });

  it("desaturate uses Rec.709 luma and keeps alpha", () => {
    const out = desaturate.cpu(solid(1, 1, [255, 0, 0, 200]), {});
    expect(px(out, 0, 0)).toEqual([54, 54, 54, 200]);
    expect(px(desaturate.cpu(solid(1, 1, [0, 255, 0, 255]), {}), 0, 0)[0]).toBe(182);
  });

  it("levels: input points stretch exactly; output points compress; gamma brightens mid-grey", () => {
    const p = defaultParams(levels);
    const src = new Raster(3, 1);
    src.setPixel(0, 0, rgba(50, 50, 50));
    src.setPixel(1, 0, rgba(150, 150, 150));
    src.setPixel(2, 0, rgba(250, 250, 250));
    const stretched = levels.cpu(src, { ...p, inBlack: 50, inWhite: 250 });
    expect(px(stretched, 0, 0)[0]).toBe(0);
    expect(px(stretched, 1, 0)[0]).toBe(128);
    expect(px(stretched, 2, 0)[0]).toBe(255);
    const compressed = levels.cpu(solid(1, 1, [255, 0, 128, 255]), { ...p, outBlack: 64, outWhite: 192 });
    expect(px(compressed, 0, 0)).toEqual([192, 64, 128, 255]);
    const gamma = levels.cpu(solid(1, 1, [128, 128, 128, 255]), { ...p, gamma: 2 });
    expect(px(gamma, 0, 0)[0]).toBeGreaterThan(170);
    // Per-channel only affects its channel.
    const red = levels.cpu(solid(1, 1, [128, 128, 128, 255]), { ...p, inWhite_r: 128 });
    expect(px(red, 0, 0)).toEqual([255, 128, 128, 255]);
  });

  it("hue +180 turns red into cyan; saturation -100 greys; colorize paints by luma", () => {
    const p = defaultParams(hueSaturation);
    const cyan = hueSaturation.cpu(solid(1, 1, [255, 0, 0, 255]), { ...p, hue: 180 });
    expect(px(cyan, 0, 0)).toEqual([0, 255, 255, 255]);
    const grey = hueSaturation.cpu(solid(1, 1, [255, 0, 0, 255]), { ...p, saturation: -100 });
    const g = px(grey, 0, 0);
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    const col = hueSaturation.cpu(solid(1, 1, [120, 120, 120, 255]), { ...p, colorize: true, hue: 0, saturation: 100 });
    const c = px(col, 0, 0);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(c[1]).toBe(c[2]);
    // Lightness +100 -> white.
    expect(px(hueSaturation.cpu(solid(1, 1, [10, 20, 30, 255]), { ...p, lightness: 100 }), 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it("color balance: midtone red shift raises R and (with preserve) keeps luma", () => {
    const p = defaultParams(colorBalance);
    const src = solid(1, 1, [128, 128, 128, 255]);
    const out = px(colorBalance.cpu(src, { ...p, cyanRed_midtones: 100 }), 0, 0);
    expect(out[0]).toBeGreaterThan(128);
    expect(out[1]).toBeLessThan(128);
    const l = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    expect(Math.abs(l - 128)).toBeLessThan(1.5);
    expect(colorBalance.cpu(src, p).equals(src)).toBe(true);
  });

  it("exposure: +1 EV doubles, defaults identity", () => {
    const p = defaultParams(exposure);
    const src = solid(1, 1, [60, 100, 200, 255]);
    expect(exposure.cpu(src, p).equals(src)).toBe(true);
    expect(px(exposure.cpu(src, { ...p, exposure: 1 }), 0, 0)).toEqual([120, 200, 255, 255]);
  });
});

describe("blur / sharpen", () => {
  it("gaussian blur preserves the mean of an opaque image (edge clamped) and is symmetric", () => {
    const src = noiseRaster(48, 32, 3);
    const m0 = meanRgb(src);
    for (const radius of [1.5, 4, 25]) {
      const out = gaussianBlur.cpu(src, { radius });
      const m1 = meanRgb(out);
      // Edge clamping re-weights border pixels, so allow more drift for big kernels.
      const tol = radius > 10 ? 10 : 2.5;
      for (let c = 0; c < 3; c++) expect(Math.abs(m1[c]! - m0[c]!)).toBeLessThan(tol);
      // Blur of the flipped image == flipped blur.
      const flipped = gaussianBlur.cpu(src.flipH(), { radius }).flipH();
      let maxDiff = 0;
      for (let i = 0; i < out.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out.data[i]! - flipped.data[i]!));
      expect(maxDiff).toBeLessThanOrEqual(1);
    }
  });

  it("gaussian blur reduces variance and leaves a solid image unchanged", () => {
    const solidR = solid(10, 10, [30, 60, 90, 255]);
    expect(gaussianBlur.cpu(solidR, { radius: 3 }).equals(solidR)).toBe(true);
    const src = noiseRaster(20, 20, 9);
    const out = gaussianBlur.cpu(src, { radius: 2 });
    const variance = (r: Raster): number => {
      const m = meanRgb(r)[0]!;
      let v = 0;
      for (let i = 0; i < r.data.length; i += 4) v += (r.data[i]! - m) ** 2;
      return v / (r.width * r.height);
    };
    expect(variance(out)).toBeLessThan(variance(src) / 4);
  });

  it("blur across a transparent edge does not darken (premultiplied)", () => {
    const src = new Raster(8, 1);
    for (let x = 0; x < 4; x++) src.setPixel(x, 0, rgba(255, 255, 255, 255));
    const out = gaussianBlur.cpu(src, { radius: 1 });
    for (let x = 0; x < 8; x++) {
      const p = px(out, x, 0);
      if (p[3] > 0) expect(p[0]).toBe(255);
    }
  });

  it("unsharp mask and sharpen increase edge contrast", () => {
    const src = new Raster(16, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) src.setPixel(x, y, x < 8 ? rgba(80, 80, 80) : rgba(170, 170, 170));
    const usm = unsharpMask.cpu(src, { amount: 150, radius: 1.5, threshold: 0 });
    expect(px(usm, 7, 1)[0]).toBeLessThan(80);
    expect(px(usm, 8, 1)[0]).toBeGreaterThan(170);
    // Far from the edge nothing changes.
    expect(px(usm, 0, 1)[0]).toBe(80);
    const sh = sharpen.cpu(src, { amount: 100 });
    expect(px(sh, 7, 1)[0]).toBeLessThan(80);
    expect(px(sh, 8, 1)[0]).toBeGreaterThan(170);
    // Threshold above the edge difference disables the effect.
    const gated = unsharpMask.cpu(src, { amount: 150, radius: 1.5, threshold: 200 });
    expect(gated.equals(src)).toBe(true);
  });

  it("motion blur of a solid image is unchanged; of a vertical stripe spreads horizontally only", () => {
    const solidR = solid(12, 6, [40, 80, 120, 255]);
    expect(motionBlur.cpu(solidR, { angle: 30, distance: 8 }).equals(solidR)).toBe(true);
    const src = new Raster(21, 5);
    for (let y = 0; y < 5; y++) src.setPixel(10, y, rgba(255, 255, 255));
    const out = motionBlur.cpu(src, { angle: 0, distance: 6 });
    expect(px(out, 8, 2)[3]).toBeGreaterThan(0);
    expect(px(out, 12, 2)[3]).toBeGreaterThan(0);
    expect(px(out, 10, 0)[3]).toBe(px(out, 10, 4)[3]);
    expect(px(out, 2, 2)[3]).toBe(0);
  });
});

describe("noise / pixelate", () => {
  it("add noise is deterministic for a seed, differs across seeds, monochrome has equal channels", () => {
    const src = solid(16, 16, [128, 128, 128, 255]);
    const p = defaultParams(addNoise);
    const a = addNoise.cpu(src, { ...p, seed: 5 });
    const b = addNoise.cpu(src, { ...p, seed: 5 });
    const c = addNoise.cpu(src, { ...p, seed: 6 });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(src)).toBe(false);
    const mono = addNoise.cpu(src, { ...p, monochrome: true, seed: 2 });
    for (let i = 0; i < mono.data.length; i += 4) {
      expect(mono.data[i]).toBe(mono.data[i + 1]);
      expect(mono.data[i]).toBe(mono.data[i + 2]);
      expect(mono.data[i + 3]).toBe(255);
    }
    const gauss = addNoise.cpu(src, { ...p, distribution: "gaussian", seed: 2 });
    expect(gauss.equals(a)).toBe(false);
    // Mean stays near the source for symmetric noise.
    const m = meanRgb(addNoise.cpu(solid(64, 64, [128, 128, 128, 255]), { ...p, amount: 50, seed: 11 }));
    expect(Math.abs(m[0]! - 128)).toBeLessThan(3);
  });

  it("pixelate makes every cell uniform and equal to the cell average", () => {
    const src = noiseRaster(20, 14, 4);
    const out = pixelate.cpu(src, { cell: 6 });
    for (let cy = 0; cy < 14; cy += 6) {
      for (let cx = 0; cx < 20; cx += 6) {
        const first = px(out, cx, cy);
        const avg = blockAverage(src, cx, cy, 6);
        for (let y = cy; y < Math.min(14, cy + 6); y++) {
          for (let x = cx; x < Math.min(20, cx + 6); x++) expect(px(out, x, y)).toEqual(first);
        }
        for (let c = 0; c < 3; c++) expect(Math.abs(first[c]! - avg[c]!)).toBeLessThanOrEqual(1);
      }
    }
  });
});
