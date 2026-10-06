import { describe, expect, it } from "vitest";
import { History, Raster, SetAdjustmentParamsCommand, opById } from "../../lib/engine";
import { propertiesContext, visibleAdjustmentParams, adjustmentDefaults, adjustmentModified, paramNumber, maskWithDensity, maskWithFeather, processMask, invertMask, resizedRaster, CONTEXT_TITLE } from "../../lib/ui/panels/Properties.model";
import { sampleDoc, byName } from "./fixtures";

describe("Properties panel context", () => {
  it("picks the page from the active layer kind, the mask target and the document", () => {
    const doc = sampleDoc();
    expect(propertiesContext(null, null, false)).toBe("none");
    expect(propertiesContext(doc, null, false)).toBe("document");
    expect(propertiesContext(doc, byName(doc, "Photo"), false)).toBe("pixel");
    expect(propertiesContext(doc, byName(doc, "Group 1"), false)).toBe("group");
    expect(propertiesContext(doc, byName(doc, "Tint"), false)).toBe("adjustment");
    expect(propertiesContext(doc, byName(doc, "Tint"), true)).toBe("mask");
    // Mask target without a mask falls back to the layer page.
    expect(propertiesContext(doc, byName(doc, "Photo"), true)).toBe("pixel");
    expect(propertiesContext(doc, byName(doc, "Title"), false)).toBe("text");
    expect(propertiesContext(doc, byName(doc, "Shape 1"), false)).toBe("shape");
    expect(CONTEXT_TITLE.mask).toBe("Masks");
  });
});

describe("adjustment layer parameter binding", () => {
  it("exposes the op's param schema (filtered by the group selector) and defaults", () => {
    const doc = sampleDoc();
    const tint = byName(doc, "Tint");
    if (tint.kind !== "adjustment") throw new Error();
    const vp = visibleAdjustmentParams(tint);
    const op = opById("hue-saturation")!;
    expect(vp.defs.map((d) => d.id)).toEqual(op.params.filter((p) => !p.group || p.group === (op.groupSelector ? String(tint.params[op.groupSelector.id]) : "")).map((p) => p.id));
    expect(vp.defs.some((d) => d.id === "saturation")).toBe(true);
    const sat = vp.defs.find((d) => d.id === "saturation")!;
    expect(paramNumber(tint.params, sat)).toBe(-40);
    expect(adjustmentModified(tint)).toBe(true);
    const d = adjustmentDefaults(tint);
    expect(d.saturation).toBe(0);
  });

  it("SetAdjustmentParamsCommand merges consecutive slider ticks into one history entry and resets", () => {
    const doc = sampleDoc();
    const h = new History(doc);
    const tint = byName(doc, "Tint");
    if (tint.kind !== "adjustment") throw new Error();
    h.push(new SetAdjustmentParamsCommand(tint.id, { saturation: -10 }, { label: "Hue/Saturation" }));
    h.push(new SetAdjustmentParamsCommand(tint.id, { saturation: 20 }, { label: "Hue/Saturation" }));
    h.push(new SetAdjustmentParamsCommand(tint.id, { hue: 15 }, { label: "Hue/Saturation" }));
    expect(h.entries.length).toBe(1);
    expect(tint.params.saturation).toBe(20);
    expect(tint.params.hue).toBe(15);
    h.push(new SetAdjustmentParamsCommand(tint.id, adjustmentDefaults(tint), { label: "Reset Adjustment" }), { noMerge: true });
    expect(adjustmentModified(tint)).toBe(false);
    expect(h.entries.length).toBe(2);
    h.undo();
    expect(tint.params.saturation).toBe(20);
    h.undo();
    expect(tint.params.saturation).toBe(-40);
  });

  it("falls back gracefully for unknown ops", () => {
    const doc = sampleDoc();
    const tint = byName(doc, "Tint");
    if (tint.kind !== "adjustment") throw new Error();
    tint.op = "does-not-exist";
    expect(visibleAdjustmentParams(tint).defs).toEqual([]);
    expect(adjustmentDefaults(tint)).toEqual({});
  });
});

describe("mask density / feather / invert", () => {
  const half = () => {
    const m = new Raster(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) m.setPixel(x, y, x < 4 ? { r: 255, g: 255, b: 255, a: 255 } : { r: 0, g: 0, b: 0, a: 255 });
    return m;
  };
  it("density 100 % keeps the mask, 0 % reveals everything, 50 % lifts black to mid gray", () => {
    const m = half();
    expect(maskWithDensity(m, 1).getPixel(6, 0).r).toBe(0);
    expect(maskWithDensity(m, 0).getPixel(6, 0).r).toBe(255);
    expect(Math.round(maskWithDensity(m, 0.5).getPixel(6, 0).r)).toBe(128);
    expect(maskWithDensity(m, 0.5).getPixel(1, 0).r).toBe(255);
  });
  it("feather blurs the edge; zero radius is a copy", () => {
    const m = half();
    const f = maskWithFeather(m, 2);
    expect(f.getPixel(3, 4).r).toBeLessThan(255);
    expect(f.getPixel(4, 4).r).toBeGreaterThan(0);
    expect(f.getPixel(0, 4).r).toBeGreaterThan(200);
    expect(maskWithFeather(m, 0)).not.toBe(m);
    expect(maskWithFeather(m, 0).getPixel(3, 4).r).toBe(255);
    const p = processMask(m, 0.5, 1);
    expect(p.getPixel(7, 4).r).toBeGreaterThan(100);
  });
  it("invert flips values and keeps alpha opaque", () => {
    const inv = invertMask(half());
    expect(inv.getPixel(1, 1).r).toBe(0);
    expect(inv.getPixel(6, 1).r).toBe(255);
    expect(inv.getPixel(6, 1).a).toBe(255);
  });
  it("resizedRaster returns null when nothing changes", () => {
    const r = new Raster(10, 10);
    expect(resizedRaster(r, 10, 10)).toBeNull();
    expect(resizedRaster(r, 20, 5)!.width).toBe(20);
  });
});
