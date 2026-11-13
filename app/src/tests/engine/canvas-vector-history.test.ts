import { expect, it } from "vitest";
import { History, Rect, ResizeImageCommand, addLayer, createDocument, createShapeLayer, rectPath, solidFill, rgba } from "../../lib/engine";

it("restores editable shape geometry, stroke width and saved paths after resizing", () => {
  const doc = createDocument({ width: 40, height: 40, noBackgroundLayer: true });
  const layer = createShapeLayer(doc, {
    path: rectPath(Rect.make(4, 5, 12, 10)), fill: solidFill(rgba(30, 80, 170)),
    stroke: { width: 2, fill: solidFill(rgba(0, 0, 0)), position: "center", cap: "round", join: "round", dash: null },
  });
  addLayer(doc, layer);
  doc.paths.push(rectPath(Rect.make(2, 3, 6, 8)));
  const originalPath = JSON.stringify(layer.path), originalSaved = JSON.stringify(doc.paths);
  const originalPixels = layer.raster.readPixels(layer.raster.bounds());
  const history = new History(doc);
  history.push(new ResizeImageCommand(80, 80, "nearest"));
  const enlargedPath = JSON.stringify(layer.path), enlargedSaved = JSON.stringify(doc.paths);
  expect(enlargedPath).not.toBe(originalPath);
  expect(layer.stroke!.width).toBe(4);
  history.undo();
  expect(JSON.stringify(layer.path)).toBe(originalPath);
  expect(JSON.stringify(doc.paths)).toBe(originalSaved);
  expect(layer.stroke!.width).toBe(2);
  expect(layer.raster.readPixels(layer.raster.bounds())).toEqual(originalPixels);
  history.redo();
  expect(JSON.stringify(layer.path)).toBe(enlargedPath);
  expect(JSON.stringify(doc.paths)).toBe(enlargedSaved);
  expect(layer.stroke!.width).toBe(4);
  history.undo();
  history.push(new ResizeImageCommand(120, 120, "nearest"));
  history.undo();
  expect(JSON.stringify(layer.path)).toBe(originalPath);
  expect(JSON.stringify(doc.paths)).toBe(originalSaved);
});
