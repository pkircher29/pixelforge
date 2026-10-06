import { describe, expect, it } from "vitest";
import { Raster, Rect, Selection, rgba } from "../../lib/engine";
import {
  blendMaskFor,
  compositeBackUnderMask,
  cropCoverage,
  emulationCropRect,
  emulationPadding,
  fitToSize,
  layerNameFor,
  maskedPatch,
  placeOnCanvas,
  regionHint,
  resolveMode,
  type ModeContext,
} from "../../lib/ai/modes";
import type { Capabilities } from "../../lib/ai/types";

const caps = (over: Partial<Capabilities>): Capabilities => ({
  generate: true,
  maskEdit: false,
  instructEdit: true,
  multiRef: true,
  maxRefs: 5,
  sizes: [],
  customSizes: true,
  aspectRatios: [],
  resolutions: [],
  maxPx: 2048,
  maxVariants: 4,
  transparentBg: false,
  models: ["m"],
  ...over,
});

const OPENAI = caps({ maskEdit: true, transparentBg: true });
const XAI = caps({});
const GEMINI = caps({ maxRefs: 14 });
const GEN_ONLY = caps({ instructEdit: false });

const ctx = (over: Partial<ModeContext>): ModeContext => ({
  hasDoc: true,
  hasPixels: true,
  selectionEmpty: false,
  selectionIsAll: false,
  caps: OPENAI,
  ...over,
});

describe("resolveMode matrix", () => {
  it("no document -> generate", () => {
    const r = resolveMode(ctx({ hasDoc: false, caps: XAI }));
    expect(r.mode).toBe("generate");
    expect(r.emulated).toBe(false);
  });

  it("empty document -> generate", () => {
    expect(resolveMode(ctx({ hasPixels: false })).mode).toBe("generate");
  });

  it("selection + native mask (OpenAI) -> mask, not emulated", () => {
    const r = resolveMode(ctx({ caps: OPENAI }));
    expect(r).toMatchObject({ mode: "mask", emulated: false });
  });

  it("selection + xAI / Gemini -> mask, emulated", () => {
    expect(resolveMode(ctx({ caps: XAI }))).toMatchObject({ mode: "mask", emulated: true });
    expect(resolveMode(ctx({ caps: GEMINI }))).toMatchObject({ mode: "mask", emulated: true });
    expect(resolveMode(ctx({ caps: XAI })).reason).toMatch(/no pixel mask/i);
  });

  it("no selection -> instruct for every editing provider", () => {
    for (const c of [OPENAI, XAI, GEMINI]) {
      const r = resolveMode(ctx({ selectionEmpty: true, caps: c }));
      expect(r.mode).toBe("instruct");
      expect(r.emulated).toBe(false);
    }
  });

  it("select-all is an instruct edit, not a mask", () => {
    expect(resolveMode(ctx({ selectionIsAll: true })).mode).toBe("instruct");
  });

  it("provider without instruct edit falls back to generate", () => {
    expect(resolveMode(ctx({ caps: GEN_ONLY })).mode).toBe("generate");
  });

  it("missing capabilities (providers not loaded) -> generate", () => {
    expect(resolveMode(ctx({ caps: null })).mode).toBe("generate");
  });

  it("forced generate wins over a selection", () => {
    expect(resolveMode(ctx({ forced: "generate" })).mode).toBe("generate");
  });

  it("forced instruct ignores the selection; forced mask without a selection degrades to instruct", () => {
    expect(resolveMode(ctx({ forced: "instruct" })).mode).toBe("instruct");
    expect(resolveMode(ctx({ forced: "mask", selectionEmpty: true })).mode).toBe("instruct");
    expect(resolveMode(ctx({ forced: "mask", caps: XAI }))).toMatchObject({ mode: "mask", emulated: true });
  });
});

describe("emulation geometry", () => {
  it("padding is max(64, 15 % of the longer edge)", () => {
    expect(emulationPadding(Rect.make(0, 0, 100, 50))).toBe(64);
    expect(emulationPadding(Rect.make(0, 0, 1000, 200))).toBe(150);
    expect(emulationPadding(Rect.make(0, 0, 200, 1000))).toBe(150);
  });

  it("crop rect grows by the padding and clamps to the canvas", () => {
    const bbox = Rect.make(100, 100, 100, 100);
    expect(emulationCropRect(bbox, 1000, 1000)).toEqual(Rect.make(36, 36, 228, 228));
    expect(emulationCropRect(bbox, 150, 150)).toEqual(Rect.make(36, 36, 114, 114));
    expect(emulationCropRect(Rect.make(0, 0, 10, 10), 500, 500)).toEqual(Rect.make(0, 0, 74, 74));
  });

  it("cropCoverage extracts the rect from a canvas-sized mask", () => {
    const sel = Selection.fromRect(10, 10, Rect.make(2, 3, 4, 2));
    const c = cropCoverage(sel.mask, 10, Rect.make(1, 2, 6, 4));
    expect(c.length).toBe(24);
    // row 0 of the crop = canvas y 2: all zero
    expect(Array.from(c.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    // row 1 = canvas y 3: x 2..5 selected -> crop x 1..4
    expect(Array.from(c.subarray(6, 12))).toEqual([0, 255, 255, 255, 255, 0]);
    expect(Array.from(c.subarray(18, 24))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("blendMaskFor feathers only when asked", () => {
    const sel = Selection.fromRect(20, 20, Rect.make(5, 5, 10, 10));
    expect(blendMaskFor(sel, 0)).toBe(sel);
    const soft = blendMaskFor(sel, 2);
    expect(soft.get(10, 10)).toBeGreaterThan(240);
    const edge = soft.get(4, 10);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it("fitToSize leaves matching rasters alone and resizes otherwise", () => {
    const r = Raster.filled(4, 4, rgba(10, 20, 30));
    expect(fitToSize(r, 4, 4)).toBe(r);
    const big = fitToSize(r, 8, 6);
    expect(big.width).toBe(8);
    expect(big.height).toBe(6);
    expect(big.getPixel(3, 3)).toEqual(rgba(10, 20, 30));
  });
});

describe("maskedPatch / composite back", () => {
  const W = 8;
  const H = 8;
  const base = Raster.filled(W, H, rgba(0, 0, 255));
  const patch = Raster.filled(4, 4, rgba(255, 0, 0));
  const rect = Rect.make(2, 2, 4, 4);

  it("hard mask: inside replaced, outside untouched", () => {
    const coverage = new Uint8Array(16).fill(255);
    coverage[0] = 0; // top-left corner of the patch is not selected
    const out = compositeBackUnderMask(base, patch, coverage, rect);
    expect(out.getPixel(0, 0)).toEqual(rgba(0, 0, 255));
    expect(out.getPixel(7, 7)).toEqual(rgba(0, 0, 255));
    expect(out.getPixel(2, 2)).toEqual(rgba(0, 0, 255)); // masked-out corner
    expect(out.getPixel(3, 3)).toEqual(rgba(255, 0, 0));
    expect(out.getPixel(5, 5)).toEqual(rgba(255, 0, 0));
  });

  it("soft edge blends linearly", () => {
    const coverage = new Uint8Array(16).fill(255);
    coverage[5] = 128; // patch pixel (1,1) -> canvas (3,3)
    const out = compositeBackUnderMask(base, patch, coverage, rect);
    const p = out.getPixel(3, 3);
    expect(p.a).toBe(255);
    expect(p.r).toBeGreaterThan(120);
    expect(p.r).toBeLessThan(136);
    expect(p.b).toBeGreaterThan(120);
    expect(p.b).toBeLessThan(136);
  });

  it("the layer raster is transparent outside the mask and keeps patch colour inside", () => {
    const coverage = new Uint8Array(16);
    coverage[5] = 255;
    coverage[6] = 64;
    const layer = maskedPatch(patch, coverage, 4, 4);
    expect(layer).not.toBe(patch); // never mutates the input
    expect(layer.getPixel(0, 0).a).toBe(0);
    expect(layer.getPixel(1, 1)).toEqual(rgba(255, 0, 0, 255));
    expect(layer.getPixel(2, 1)).toEqual(rgba(255, 0, 0, 64));
    const canvas = placeOnCanvas(layer, rect, W, H);
    expect(canvas.width).toBe(W);
    expect(canvas.getPixel(3, 3)).toEqual(rgba(255, 0, 0, 255));
    expect(canvas.getPixel(4, 3).a).toBe(64);
    expect(canvas.getPixel(0, 0).a).toBe(0);
    expect(canvas.getPixel(7, 7).a).toBe(0);
  });

  it("resizes a provider result that came back at a different size", () => {
    const big = Raster.filled(9, 7, rgba(0, 255, 0));
    const coverage = new Uint8Array(16).fill(255);
    const layer = maskedPatch(big, coverage, 4, 4);
    expect(layer.width).toBe(4);
    expect(layer.height).toBe(4);
    expect(layer.getPixel(2, 2)).toEqual(rgba(0, 255, 0));
  });

  it("rejects a coverage of the wrong size", () => {
    expect(() => maskedPatch(patch, new Uint8Array(3), 4, 4)).toThrow(RangeError);
  });
});

describe("prompt / name helpers", () => {
  it("layer name is '<Provider>: <first 40 chars>'", () => {
    expect(layerNameFor("Grok", "a red  fox")).toBe("Grok: a red fox");
    const long = "x".repeat(60);
    const name = layerNameFor("Gemini", long);
    expect(name.startsWith("Gemini: ")).toBe(true);
    expect(name.length).toBe("Gemini: ".length + 41);
    expect(layerNameFor("ChatGPT", "   ")).toBe("ChatGPT: untitled");
  });

  it("region hint prefixes the prompt", () => {
    const h = regionHint("make it blue");
    expect(h.endsWith("make it blue")).toBe(true);
    expect(h).toMatch(/surrounding pixels unchanged/);
  });
});
