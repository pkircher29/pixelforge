/**
 * Help ▸ Open Sample Document — a procedurally built scene that exercises the v0.2 layer
 * system (groups, clipped adjustment layer with a mask, fill layer, shape layers, a text
 * layer with layer styles) so new users have something to poke at.
 */
import { docStore } from "$lib/stores/doc.svelte";
import { registerCommand } from "$lib/ui/registry.svelte";
import {
  BlendMode,
  Raster,
  Rect,
  addLayer,
  createAdjustmentLayer,
  createDocument,
  createFillLayer,
  createGroupLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  defaultDropShadow,
  defaultOuterGlow,
  defaultStroke,
  ellipsePath,
  gradientFill,
  regularPolygonPath,
  roundedRectPath,
  textSpec,
  type Document,
  type Layer,
} from "$lib/engine";

const W = 1600;
const H = 1000;

function push(doc: Document, layer: Layer): void {
  addLayer(doc, layer, doc.layers.length);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sky: vertical dusk gradient with a little dithering. */
function paintSky(r: Raster): void {
  const d = r.data;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const top = [24, 22, 66];
    const mid = [196, 78, 112];
    const low = [252, 176, 92];
    const k = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
    const a = t < 0.55 ? top : mid;
    const b = t < 0.55 ? mid : low;
    for (let x = 0; x < W; x++) {
      const n = ((x * 7 + y * 13) % 5) - 2;
      const i = (y * W + x) * 4;
      d[i] = lerp(a[0]!, b[0]!, k) + n;
      d[i + 1] = lerp(a[1]!, b[1]!, k) + n;
      d[i + 2] = lerp(a[2]!, b[2]!, k) + n;
      d[i + 3] = 255;
    }
  }
}

/** A ridge silhouette: height field from summed sines, filled below the line. */
function paintRidge(r: Raster, base: number, amp: number, seed: number, rgb: [number, number, number]): void {
  const d = r.data;
  for (let x = 0; x < W; x++) {
    const h =
      base -
      amp * (0.55 * Math.sin(x * 0.004 + seed) + 0.3 * Math.sin(x * 0.011 + seed * 2.1) + 0.15 * Math.sin(x * 0.031 + seed * 3.7));
    const top = Math.max(0, Math.floor(h));
    for (let y = top; y < H; y++) {
      const i = (y * W + x) * 4;
      const shade = Math.min(1, (y - top) / 260);
      d[i] = rgb[0] * (1 - shade * 0.5);
      d[i + 1] = rgb[1] * (1 - shade * 0.5);
      d[i + 2] = rgb[2] * (1 - shade * 0.5);
      d[i + 3] = 255;
    }
  }
}

export function buildSampleDocument(): Document {
  const doc = createDocument({ name: "Pixelforge Sample", width: W, height: H, background: "white" });
  const bg = doc.layers[0];
  if (bg && bg.kind === "raster") {
    bg.name = "Sky";
    paintSky(bg.raster);
  }

  const sun = createShapeLayer(doc, {
    name: "Sun",
    path: ellipsePath(Rect.make(1040, 300, 260, 260)),
    fill: { type: "solid", color: { r: 255, g: 226, b: 150, a: 255 } },
    stroke: null,
    effects: { outerGlow: defaultOuterGlow({ size: 90, spread: 8, opacity: 0.85, color: { r: 255, g: 190, b: 110, a: 255 } }) },
  });
  push(doc, sun);

  const land = createGroupLayer(doc, { name: "Landscape" });
  push(doc, land);
  const far = createRasterLayer(doc, { name: "Far ridge", parentId: land.id });
  paintRidge(far.raster, 640, 120, 1.3, [92, 52, 104]);
  push(doc, far);
  const near = createRasterLayer(doc, { name: "Near ridge", parentId: land.id });
  paintRidge(near.raster, 820, 90, 4.2, [38, 24, 52]);
  push(doc, near);

  const grade = createAdjustmentLayer(doc, {
    op: "hue-saturation",
    name: "Hue/Saturation 1",
    parentId: land.id,
    clipToBelow: true,
    params: { hue: -18, saturation: 25 },
  });
  const mask = Raster.filled(W, H, { r: 255, g: 255, b: 255, a: 255 });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.round(Math.min(1, x / W) * 255);
    const i = (y * W + x) * 4;
    mask.data[i] = v;
    mask.data[i + 1] = v;
    mask.data[i + 2] = v;
  }
  grade.mask = mask;
  push(doc, grade);

  const haze = createFillLayer(doc, {
    name: "Haze",
    fill: gradientFill(
      [
        { pos: 0, color: { r: 255, g: 160, b: 120, a: 0 } },
        { pos: 1, color: { r: 255, g: 200, b: 150, a: 160 } },
      ],
      { angle: 90 },
    ),
    opacity: 0.55,
    blendMode: BlendMode.Screen,
  });
  push(doc, haze);

  const badge = createShapeLayer(doc, {
    name: "Badge",
    path: roundedRectPath(Rect.make(120, 120, 300, 70), 35),
    fill: { type: "solid", color: { r: 20, g: 115, b: 230, a: 255 } },
    stroke: { width: 2, fill: { type: "solid", color: { r: 255, g: 255, b: 255, a: 200 } }, position: "inside", cap: "round", join: "round", dash: null },
    effects: { dropShadow: defaultDropShadow({ distance: 6, size: 12, opacity: 0.5 }) },
  });
  push(doc, badge);
  push(
    doc,
    createTextLayer(doc, {
      name: "Badge label",
      text: textSpec("AI LAYERS · v0.2", 150, 168, { size: 30, bold: true, color: { r: 255, g: 255, b: 255, a: 255 } }),
    }),
  );

  const star = createShapeLayer(doc, {
    name: "Star",
    path: regularPolygonPath(1380, 160, 60, 5),
    fill: { type: "solid", color: { r: 255, g: 240, b: 200, a: 255 } },
    stroke: { width: 4, fill: { type: "solid", color: { r: 40, g: 20, b: 60, a: 255 } }, position: "outside", cap: "round", join: "round", dash: null },
  });
  push(doc, star);

  const title = createTextLayer(doc, {
    name: "Pixelforge",
    text: textSpec("Pixelforge", 120, 470, { size: 150, bold: true, color: { r: 255, g: 255, b: 255, a: 255 } }),
    effects: {
      dropShadow: defaultDropShadow({ distance: 12, size: 24, opacity: 0.6 }),
      stroke: defaultStroke({ size: 4, position: "outside", color: { r: 40, g: 20, b: 60, a: 255 } }),
    },
  });
  push(doc, title);

  doc.activeLayerId = title.id;
  doc.dirty = false;
  return doc;
}

registerCommand({
  id: "help.sampleDocument",
  label: "Open Sample Document",
  menu: "Help",
  order: 50,
  keywords: ["demo", "example", "sample"],
  run: () => {
    const entry = docStore.open(buildSampleDocument(), null);
    entry.dirty = false;
  },
});
