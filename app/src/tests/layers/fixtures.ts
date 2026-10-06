/** Shared synthetic documents for the Layers-panel test suites. */
import { Raster, Rect, addLayer, createAdjustmentLayer, createDocument, createGroupLayer, createRasterLayer, createTextLayer, defaultDropShadow, defaultStroke, rectPath, createShapeLayer, textSpec, type Document, type Layer } from "../../lib/engine";

export const W = 32;
export const H = 24;

/**
 * Bottom → top:
 *  0 Background (raster, white)
 *  1 Group 1 (group)
 *  2   Photo (raster, child)
 *  3   Tint (adjustment hue-saturation with mask, child, clipped to Photo)
 *  4 Shape 1 (shape)
 *  5 Title (text with Drop Shadow + Stroke)
 */
export function sampleDoc(): Document {
  const doc = createDocument({ width: W, height: H, background: "white" });
  const group = createGroupLayer(doc, { name: "Group 1" });
  addLayer(doc, group, 1);
  const photo = createRasterLayer(doc, { name: "Photo", parentId: group.id });
  photo.raster.fill({ r: 200, g: 40, b: 40, a: 255 }, { x: 4, y: 4, w: 12, h: 10 });
  addLayer(doc, photo, 2);
  const tint = createAdjustmentLayer(doc, { op: "hue-saturation", name: "Tint", parentId: group.id, clipToBelow: true, params: { saturation: -40 } });
  tint.mask = Raster.filled(W, H, { r: 255, g: 255, b: 255, a: 255 });
  addLayer(doc, tint, 3);
  const shape = createShapeLayer(doc, { name: "Shape 1", path: rectPath(Rect.make(10, 6, 14, 12)), fill: { type: "solid", color: { r: 30, g: 120, b: 220, a: 255 } } });
  addLayer(doc, shape, 4);
  const title = createTextLayer(doc, { name: "Title", text: textSpec("Hi", 2, 20, { size: 16 }), effects: { dropShadow: defaultDropShadow(), stroke: defaultStroke() } });
  addLayer(doc, title, 5);
  doc.activeLayerId = title.id;
  return doc;
}

export function byName(doc: Document, name: string): Layer {
  const l = doc.layers.find((x) => x.name === name);
  if (!l) throw new Error(`no layer ${name}`);
  return l;
}

export function names(doc: Document): string[] {
  return doc.layers.map((l) => l.name);
}
