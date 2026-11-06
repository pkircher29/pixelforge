import { expect, it } from "vitest";
import { History, Raster, Rect, Selection, addLayer, createDocument, createRasterLayer, rgba } from "../../lib/engine";
import { PrepareExpandCommand } from "../../lib/engine/commands/canvas";

it.each([
  Rect.make(-2, 0, 6, 3), Rect.make(0, -2, 4, 5),
  Rect.make(0, 0, 6, 3), Rect.make(0, 0, 4, 5), Rect.make(-2, -1, 8, 6),
])("expansion preserves original pixels and selects only newly added space: %j", (rect) => {
  const doc = createDocument({ width: 4, height: 3, noBackgroundLayer: true });
  const original = Raster.filled(4, 3, rgba(12, 34, 56));
  original.setPixel(3, 2, rgba(98, 76, 54));
  const layer = createRasterLayer(doc, { raster: original });
  addLayer(doc, layer);
  const selection = Selection.fromRect(4, 3, Rect.make(1, 1, 2, 1));
  doc.selection = selection;
  const history = new History(doc);
  history.push(new PrepareExpandCommand(rect));
  expect([doc.width, doc.height]).toEqual([rect.w, rect.h]);
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    const ox = x + rect.x, oy = y + rect.y;
    const inside = ox >= 0 && ox < 4 && oy >= 0 && oy < 3;
    expect(doc.selection.mask[y * rect.w + x]).toBe(inside ? 0 : 255);
    expect(layer.raster.getPixel(x, y)).toEqual(inside ? original.getPixel(ox, oy) : rgba(0, 0, 0, 0));
  }
  const expanded = layer.raster;
  const mask = doc.selection;
  history.undo();
  expect([doc.width, doc.height]).toEqual([4, 3]);
  expect(layer.raster).toBe(original);
  expect(doc.selection).toBe(selection);
  history.redo();
  expect(layer.raster).toBe(expanded);
  expect(doc.selection).toBe(mask);
});

it("rejects shrinking, shifted and unchanged bounds before mutating the document", () => {
  const doc = createDocument({ width: 4, height: 3 });
  const layer = doc.layers[0]!;
  const raster = layer.raster;
  for (const r of [Rect.make(0, 0, 4, 3), Rect.make(1, 0, 5, 3), Rect.make(-1, 0, 4, 3), Rect.make(0, 0, 3, 2)]) {
    expect(() => new PrepareExpandCommand(r).do(doc)).toThrow(/Extend/);
    expect([doc.width, doc.height]).toEqual([4, 3]);
    expect(layer.raster).toBe(raster);
  }
  expect(() => new PrepareExpandCommand(Rect.make(0.5, 0, 5, 3))).toThrow();
  expect(() => new PrepareExpandCommand(Rect.make(0, 0, 999999, 3))).toThrow();
});
