import { describe, expect, it } from "vitest";
import { Raster, rgba } from "../../lib/engine";
import { autoLevelsForChannel, computeHistogram, histogramPeak } from "../../lib/filters/histogram";
import { levels } from "../../lib/filters/ops";
import { defaultParams } from "../../lib/filters/types";

describe("histogram + auto levels", () => {
  it("counts opaque pixels per channel and luma", () => {
    const r = new Raster(4, 1);
    r.setPixel(0, 0, rgba(0, 0, 0));
    r.setPixel(1, 0, rgba(255, 255, 255));
    r.setPixel(2, 0, rgba(255, 0, 0));
    r.setPixel(3, 0, rgba(10, 10, 10, 0)); // transparent: ignored
    const h = computeHistogram(r);
    expect(h.count).toBe(3);
    expect(h.r[255]).toBe(2);
    expect(h.r[0]).toBe(1);
    expect(h.g[0]).toBe(2);
    expect(h.l[0]).toBe(1);
    expect(h.l[255]).toBe(1);
    expect(h.l[54]).toBe(1);
    // Ends are trimmed for the peak unless the interior is empty (then the full peak is used).
    expect(histogramPeak(h.r)).toBe(2);
    expect(histogramPeak(h.l)).toBe(1);
  });

  it("auto picks black/white points that clip 0.1 % per end", () => {
    const bins = new Uint32Array(256);
    // 3220 pixels spread 40..200, plus 1 outlier at 0 and 1 at 255 (each < 0.1 %).
    for (let v = 40; v <= 200; v++) bins[v] = 20;
    bins[0] = 1;
    bins[255] = 1;
    const count = bins.reduce((a, b) => a + b, 0);
    const { black, white } = autoLevelsForChannel(bins, count);
    expect(black).toBe(40);
    expect(white).toBe(200);
    expect(autoLevelsForChannel(new Uint32Array(256), 0)).toEqual({ black: 0, white: 255 });
  });

  it("levels.auto computed from a histogram stretches each channel independently", () => {
    const r = new Raster(64, 1);
    for (let x = 0; x < 64; x++) r.setPixel(x, 0, rgba(40 + x, 100 + x, 200));
    const auto = levels.auto!(computeHistogram(r));
    expect(auto.inBlack_r).toBe(40);
    expect(auto.inWhite_r).toBe(103);
    expect(auto.inBlack_g).toBe(100);
    expect(auto.inWhite_g).toBe(163);
    expect(auto.inBlack_b).toBe(200);
    expect(auto.inWhite_b).toBe(202);
    const out = levels.cpu(r, { ...defaultParams(levels), ...auto });
    expect(out.getPixel(0, 0).r).toBe(0);
    expect(out.getPixel(63, 0).r).toBe(255);
    expect(out.getPixel(0, 0).g).toBe(0);
    expect(out.getPixel(63, 0).g).toBe(255);
  });
});
