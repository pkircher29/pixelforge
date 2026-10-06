import { describe, expect, it } from "vitest";
import {
  History,
  Raster,
  Rect,
  Selection,
  addLayer,
  createDocument,
  createRasterLayer,
  getRasterLayer,
  rgba,
  type Command,
  type Document,
} from "../../lib/engine";
import {
  CompositeCommand,
  FlipImageCommand,
  RotateCanvasCommand,
  RotateImageCommand,
  rotateCanvasBounds,
} from "../../lib/filters/transform/commands";
import { trimRect } from "../../lib/filters/transform/trim";

function docWithDot(): { doc: Document; id: string } {
  const doc = createDocument({ width: 8, height: 6, noBackgroundLayer: true });
  const layer = createRasterLayer(doc, { name: "L", raster: new Raster(4, 3), offset: { x: 1, y: 2 } });
  layer.raster.setPixel(0, 0, rgba(255, 0, 0)); // doc (1, 2)
  layer.raster.setPixel(3, 2, rgba(0, 0, 255)); // doc (4, 4)
  addLayer(doc, layer);
  doc.activeLayerId = layer.id;
  return { doc, id: layer.id };
}

describe("rotate canvas bounds", () => {
  it("45° on a square grows to ceil(side * sqrt 2); 90° swaps sides; 0/180 keep them", () => {
    expect(rotateCanvasBounds(100, 100, 45)).toMatchObject({ w: 142, h: 142 });
    expect(rotateCanvasBounds(100, 50, 90)).toMatchObject({ w: 50, h: 100 });
    expect(rotateCanvasBounds(100, 50, 0)).toEqual(Rect.ofSize(100, 50));
    expect(rotateCanvasBounds(100, 50, 180)).toMatchObject({ w: 100, h: 50 });
    const r = rotateCanvasBounds(200, 100, 30);
    expect(r.w).toBe(Math.ceil(200 * Math.cos(Math.PI / 6) + 100 * Math.sin(Math.PI / 6)) + (r.w % 2 === 0 ? 0 : 0));
    expect(r.w).toBeGreaterThanOrEqual(223);
    expect(r.h).toBeGreaterThanOrEqual(186);
  });
});

describe("RotateImageCommand / FlipImageCommand", () => {
  it("90° CW moves doc pixels to (h-1-y, x) and swaps the canvas size; undo restores", () => {
    const { doc, id } = docWithDot();
    const h = new History(doc);
    h.push(new RotateImageCommand("90cw"));
    expect(doc.width).toBe(6);
    expect(doc.height).toBe(8);
    const l = getRasterLayer(doc, id);
    // doc (1,2) -> (6-1-2, 1) = (3, 1); doc (4,4) -> (1, 4)
    expect(l.raster.getPixel(3 - l.offset.x, 1 - l.offset.y)).toEqual(rgba(255, 0, 0));
    expect(l.raster.getPixel(1 - l.offset.x, 4 - l.offset.y)).toEqual(rgba(0, 0, 255));
    h.undo();
    expect(doc.width).toBe(8);
    expect(getRasterLayer(doc, id).offset).toEqual({ x: 1, y: 2 });
    expect(getRasterLayer(doc, id).raster.getPixel(0, 0)).toEqual(rgba(255, 0, 0));
  });

  it("90° CCW then 90° CW is identity; 180° equals flipH+flipV", () => {
    const { doc, id } = docWithDot();
    const before = getRasterLayer(doc, id).raster.clone();
    const h = new History(doc);
    h.push(new RotateImageCommand("90ccw"));
    h.push(new RotateImageCommand("90cw"));
    const l = getRasterLayer(doc, id);
    expect(l.offset).toEqual({ x: 1, y: 2 });
    expect(l.raster.equals(before)).toBe(true);
    h.push(new RotateImageCommand("180"));
    // doc (1,2) -> (8-1-1, 6-1-2) = (6, 3)
    const l2 = getRasterLayer(doc, id);
    expect(l2.raster.getPixel(6 - l2.offset.x, 3 - l2.offset.y)).toEqual(rgba(255, 0, 0));
  });

  it("flip horizontal mirrors offsets and selection", () => {
    const { doc, id } = docWithDot();
    doc.selection = Selection.fromRect(8, 6, Rect.make(0, 0, 2, 6));
    new FlipImageCommand("h").do(doc);
    const l = getRasterLayer(doc, id);
    // doc (1,2) -> (8-1-1, 2) = (6, 2)
    expect(l.raster.getPixel(6 - l.offset.x, 2 - l.offset.y)).toEqual(rgba(255, 0, 0));
    expect(doc.selection.get(7, 0)).toBe(255);
    expect(doc.selection.get(0, 0)).toBe(0);
  });
});

describe("RotateCanvasCommand (arbitrary)", () => {
  it("expands the canvas, keeps every layer full-canvas at offset 0, and undoes exactly", () => {
    const doc = createDocument({ width: 20, height: 10, background: "white" });
    const h = new History(doc);
    const before = doc.layers[0]!.raster!.clone();
    h.push(new RotateCanvasCommand(30));
    const b = rotateCanvasBounds(20, 10, 30);
    expect(doc.width).toBe(b.w);
    expect(doc.height).toBe(b.h);
    const l = doc.layers[0]!;
    expect(l.raster!.width).toBe(b.w);
    expect(l.offset).toEqual({ x: 0, y: 0 });
    // Corners are transparent, centre stays white.
    expect(l.raster!.getPixel(0, 0).a).toBe(0);
    expect(l.raster!.getPixel(Math.floor(b.w / 2), Math.floor(b.h / 2))).toEqual(rgba(255, 255, 255));
    expect(doc.selection.width).toBe(b.w);
    h.undo();
    expect(doc.width).toBe(20);
    expect(doc.layers[0]!.raster!.equals(before)).toBe(true);
  });

  it("multiples of 90 use the exact path", () => {
    const { doc, id } = docWithDot();
    new RotateCanvasCommand(270).do(doc);
    expect(doc.width).toBe(6);
    const l = getRasterLayer(doc, id);
    // 270 cw == 90 ccw: (x, y) -> (y, w-1-x): (1,2) -> (2, 6)
    expect(l.raster.getPixel(2 - l.offset.x, 6 - l.offset.y)).toEqual(rgba(255, 0, 0));
  });
});

describe("trim + composite command", () => {
  it("trimRect finds the opaque bbox and returns null when nothing to trim", () => {
    const { doc } = docWithDot();
    expect(trimRect(doc)).toEqual({ x: 1, y: 2, w: 4, h: 3 });
    expect(trimRect(doc, { top: false, left: false })).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    const full = createDocument({ width: 4, height: 4, background: "white" });
    expect(trimRect(full)).toBeNull();
    expect(trimRect(full, { basis: "top-left" })).toBeNull();
    // Edge-colour trimming on a white doc with a dark dot.
    full.layers[0]!.raster!.setPixel(2, 1, rgba(0, 0, 0));
    expect(trimRect(full, { basis: "top-left" })).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it("CompositeCommand runs do in order and undo in reverse as one entry", () => {
    const log: string[] = [];
    const mk = (n: string): Command => ({
      label: n,
      do: () => log.push(`do:${n}`),
      undo: () => log.push(`undo:${n}`),
      byteSize: () => 10,
    });
    const doc = createDocument({ width: 2, height: 2 });
    const h = new History(doc);
    const c = new CompositeCommand("Both", [mk("a"), mk("b")]);
    h.push(c);
    expect(h.entries.length).toBe(1);
    expect(c.byteSize()).toBe(20);
    h.undo();
    expect(log).toEqual(["do:a", "do:b", "undo:b", "undo:a"]);
  });
});
