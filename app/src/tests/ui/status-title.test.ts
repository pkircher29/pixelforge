import { describe, expect, it } from "vitest";
import { formatDocSize, statusInfoText } from "../../lib/ui/status-info";
import { docTitle } from "../../lib/ui/doc-title";
import { majorStep, minorDivisions, pxPerUnit, formatTick } from "../../lib/ui/rulers";

const base = { w: 1920, h: 1080, dpi: 72, layerCount: 2, flat: 1920 * 1080 * 4, layerBytes: 1920 * 1080 * 4 * 2, historyBytes: 10 * 1048576, budgetBytes: 1024 * 1048576, renderMs: 12.4, toolName: "Move Tool" };

describe("status bar", () => {
  it("formats sizes like Photoshop (K/M/G, 2 decimals)", () => {
    expect(formatDocSize(1920 * 1080 * 4)).toBe("7.91M");
    expect(formatDocSize(512)).toBe("512B");
    expect(formatDocSize(2048)).toBe("2.0K");
    expect(formatDocSize(3 * 1073741824)).toBe("3.00G");
  });

  it("renders every info kind", () => {
    expect(statusInfoText("sizes", base)).toBe("Doc: 7.91M/15.82M");
    expect(statusInfoText("dimensions", base)).toBe("1920 px × 1080 px (72 ppi)");
    expect(statusInfoText("profile", base)).toContain("sRGB");
    expect(statusInfoText("scratch", base)).toMatch(/^Scr: .*\/1\.00G$/);
    expect(statusInfoText("efficiency", base)).toBe("Efficiency: 99%");
    expect(statusInfoText("timing", base)).toBe("0.01s");
    expect(statusInfoText("tool", base)).toBe("Move Tool");
  });
});

describe("document title", () => {
  it("is 'Name @ zoom (Layer, RGB/8)' with a dirty star", () => {
    const e = { doc: { name: "Untitled-1", layers: [{ id: "a", name: "Layer 1" }], activeLayerId: "a" }, viewport: { zoom: 2 / 3 }, dirty: true };
    expect(docTitle(e)).toBe("Untitled-1 @ 66.7% (Layer 1, RGB/8)");
    expect(docTitle(e, { dirtyMark: true })).toBe("Untitled-1 @ 66.7% (Layer 1, RGB/8) *");
    expect(docTitle({ ...e, doc: { ...e.doc, activeLayerId: null } })).toBe("Untitled-1 @ 66.7% (RGB/8)");
  });
});

describe("rulers", () => {
  it("picks 1-2-5 major steps that keep labels ≥ 60 px apart at any zoom", () => {
    expect(majorStep(1)).toBe(100);
    expect(majorStep(0.25)).toBe(500);
    expect(majorStep(4)).toBe(20);
    expect(majorStep(32)).toBe(2);
    for (const z of [0.01, 0.13, 0.5, 1, 3, 7, 16, 32]) expect(majorStep(z) * z).toBeGreaterThanOrEqual(60);
  });

  it("converts units and subdivides majors", () => {
    expect(pxPerUnit("px", 300, 1000)).toBe(1);
    expect(pxPerUnit("in", 300, 1000)).toBe(300);
    expect(pxPerUnit("cm", 254, 1000)).toBeCloseTo(100);
    expect(pxPerUnit("mm", 254, 1000)).toBeCloseTo(10);
    expect(pxPerUnit("%", 72, 1000)).toBe(10);
    expect(minorDivisions(130)).toBe(10);
    expect(minorDivisions(60)).toBe(5);
    expect(minorDivisions(30)).toBe(2);
    expect(minorDivisions(10)).toBe(1);
    expect(formatTick(0.1 + 0.2)).toBe("0.3");
  });
});
