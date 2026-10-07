import { describe, expect, it } from "vitest";
import { BlendMode, Raster, Rect } from "../../lib/engine";
import { DEFAULT_FILL, fillLabel, fillPixels, fillSolidColor, normalizeFill, normalizeStroke, patternSource, strokeBand } from "../../lib/ui/commands/fill-stroke";

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

describe("Edit ▸ Fill / Stroke option plumbing", () => {
  it("resolves solid contents and clamps dialog values", () => {
    expect(fillSolidColor("foreground", RED, BLUE, BLUE)).toEqual(RED);
    expect(fillSolidColor("background", RED, BLUE, RED)).toEqual(BLUE);
    expect(fillSolidColor("gray", RED, BLUE, RED)).toEqual({ r: 128, g: 128, b: 128, a: 255 });
    expect(fillSolidColor("pattern", RED, BLUE, RED)).toBeNull();
    expect(normalizeFill({ opacity: 250, contents: "nope" as never })).toMatchObject({ opacity: 100, contents: "foreground" });
    expect(normalizeStroke({ width: 0, opacity: -3, location: "weird" as never })).toMatchObject({ width: 1, opacity: 0, location: "center" });
    expect(fillLabel({ ...DEFAULT_FILL, contents: "history" })).toBe("Fill (History)");
  });

  it("fills through coverage with opacity and blend mode", () => {
    const r = new Raster(4, 4);
    r.fill({ r: 0, g: 0, b: 255, a: 255 });
    const touched = fillPixels(r, { x: 0, y: 0 }, Rect.make(0, 0, 2, 4), () => 1, () => RED, { mode: BlendMode.Normal, opacity: 0.5, preserve: false });
    expect(touched).toEqual(Rect.make(0, 0, 2, 4));
    const p = r.getPixel(0, 0);
    expect(p.r).toBeGreaterThan(120);
    expect(p.b).toBeGreaterThan(120);
    expect(r.getPixel(3, 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    const m = new Raster(1, 1);
    m.fill({ r: 128, g: 128, b: 128, a: 255 });
    fillPixels(m, { x: 0, y: 0 }, Rect.make(0, 0, 1, 1), () => 1, () => ({ r: 128, g: 128, b: 128, a: 255 }), { mode: BlendMode.Multiply, opacity: 1, preserve: false });
    expect(m.getPixel(0, 0).r).toBeLessThan(70);
  });

  it("Preserve Transparency leaves empty pixels empty and keeps alpha", () => {
    const r = new Raster(2, 1);
    r.setPixel(0, 0, { r: 0, g: 255, b: 0, a: 128 });
    fillPixels(r, { x: 0, y: 0 }, r.bounds(), () => 1, () => RED, { mode: BlendMode.Normal, opacity: 1, preserve: true });
    expect(r.getPixel(0, 0)).toMatchObject({ r: 255, g: 0, a: 128 });
    expect(r.getPixel(1, 0).a).toBe(0);
  });

  it("respects the layer offset and tiles patterns from the document origin", () => {
    const r = new Raster(2, 2);
    const seen: [number, number][] = [];
    fillPixels(r, { x: 10, y: 20 }, r.bounds(), (x, y) => (seen.push([x, y]), 1), () => RED, { mode: BlendMode.Normal, opacity: 1, preserve: false });
    expect(seen[0]).toEqual([10, 20]);
    const tile = new Raster(2, 1);
    tile.setPixel(0, 0, RED);
    tile.setPixel(1, 0, BLUE);
    const src = patternSource(tile);
    expect(src(4, 7)).toEqual(RED);
    expect({ ...src(-1, 0) }).toEqual(BLUE);
  });

  it("builds inside / center / outside stroke bands around a selection", () => {
    const W = 20;
    const mask = new Uint8Array(W * W);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * W + x] = 255;
    const bb = Rect.make(5, 5, 10, 10);
    const at = (b: ReturnType<typeof strokeBand>, x: number, y: number): number => b.band[(y - b.rect.y) * b.rect.w + (x - b.rect.x)]!;
    const inside = strokeBand(mask, W, W, bb, 2, "inside");
    expect(at(inside, 5, 10)).toBeGreaterThan(0.5);
    expect(at(inside, 10, 10)).toBe(0);
    expect(at(inside, 3, 10)).toBe(0);
    const outside = strokeBand(mask, W, W, bb, 2, "outside");
    expect(at(outside, 4, 10)).toBeGreaterThan(0.5);
    expect(at(outside, 6, 10)).toBe(0);
    const center = strokeBand(mask, W, W, bb, 2, "center");
    expect(at(center, 4, 10)).toBeGreaterThan(0.3);
    expect(at(center, 5, 10)).toBeGreaterThan(0.3);
    expect(at(center, 10, 10)).toBe(0);
  });
});
