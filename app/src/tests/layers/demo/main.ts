/**
 * Temporary Vite page for visual verification of the Layers / Channels / Paths /
 * Properties panels: mounts the full shell with a seeded document (group, clipped
 * adjustment layer with a mask, shape, text layer with Drop Shadow + Stroke).
 * Open http://localhost:1420/src/tests/layers/demo/index.html with `npm run dev`.
 */
import { mount } from "svelte";
import "../../../app.css";
import App from "../../../App.svelte";
import { docStore } from "$lib/stores/doc.svelte";
import { layersUi } from "$lib/ui/panels/Layers.store.svelte";
import { Raster, Rect, addLayer, createAdjustmentLayer, createDocument, createGroupLayer, createRasterLayer, createShapeLayer, createTextLayer, defaultDropShadow, defaultStroke, rectPath, ellipsePath, textSpec, gradientFill, createFillLayer, newPath } from "$lib/engine";

const W = 640;
const H = 400;
const doc = createDocument({ name: "layers-demo", width: W, height: H, background: "white" });
const group = createGroupLayer(doc, { name: "Group 1" });
addLayer(doc, group, 1);
const photo = createRasterLayer(doc, { name: "Photo", parentId: group.id });
for (let y = 40; y < 300; y++) for (let x = 60; x < 360; x++) photo.raster.setPixel(x, y, { r: 40 + ((x - 60) * 200) / 300, g: 90, b: 200 - ((y - 40) * 150) / 260, a: 255 });
addLayer(doc, photo, 2);
const tint = createAdjustmentLayer(doc, { op: "hue-saturation", name: "Hue/Saturation 1", parentId: group.id, clipToBelow: true, params: { saturation: -35, hue: 20 } });
const m = Raster.filled(W, H, { r: 255, g: 255, b: 255, a: 255 });
for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) m.setPixel(x, y, { r: 0, g: 0, b: 0, a: 255 });
tint.mask = m;
addLayer(doc, tint, 3);
const fill = createFillLayer(doc, { name: "Gradient Fill 1", fill: gradientFill([{ pos: 0, color: { r: 255, g: 200, b: 60, a: 255 } }, { pos: 1, color: { r: 240, g: 60, b: 120, a: 0 } }], { angle: 45 }), opacity: 0.6 });
addLayer(doc, fill, 4);
const shape = createShapeLayer(doc, { name: "Ellipse 1", path: ellipsePath(Rect.make(380, 120, 200, 160)), fill: { type: "solid", color: { r: 30, g: 160, b: 90, a: 255 } }, stroke: { width: 6, fill: { type: "solid", color: { r: 255, g: 255, b: 255, a: 255 } }, position: "center", cap: "round", join: "round", dash: null } });
addLayer(doc, shape, 5);
const title = createTextLayer(doc, { name: "Pixelforge", text: textSpec("Pixelforge", 60, 360, { size: 64, bold: true, color: { r: 250, g: 250, b: 250, a: 255 } }), effects: { dropShadow: defaultDropShadow({ distance: 8, size: 10 }), stroke: defaultStroke({ color: { r: 20, g: 20, b: 20, a: 255 }, size: 3 }) } });
addLayer(doc, title, 6);
doc.paths = [newPath("Work Path", rectPath(Rect.make(100, 80, 240, 180)).subpaths)];
doc.workPathId = doc.paths[0]!.id;
doc.activeLayerId = title.id;
const entry = docStore.open(doc, null);
entry.dirty = false;
doc.dirty = false;
layersUi.bind(entry.id);
layersUi.expandedEffects = [title.id];

mount(App, { target: document.getElementById("app")! });
