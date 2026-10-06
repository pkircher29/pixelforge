import { describe, expect, it } from "vitest";
import { PFPROJ_FORMAT, documentFromProjectFrame, projectFrameParts, bytesToBase64, base64ToBytes, type ProjectHeader, type Manifest } from "../../lib/io/convert";
import { decodeFrame, encodeFrame } from "../../lib/io/frame";
import {
  BlendMode,
  Raster,
  Rect,
  Selection,
  addLayer,
  compositeToRaster,
  createAdjustmentLayer,
  createDocument,
  createFillLayer,
  createGroupLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  defaultDropShadow,
  defaultStroke,
  gradientFill,
  patternFill,
  rectPath,
  rgba,
  saveSelectionAsChannel,
  solidFill,
  textSpec,
  type AdjustmentLayer,
  type FillLayer,
  type RasterLayer,
  type ShapeLayer,
  type TextLayer,
} from "../../lib/engine";

function roundTrip(doc: ReturnType<typeof createDocument>): { back: ReturnType<typeof createDocument>; manifest: Manifest } {
  const { header, blobs } = projectFrameParts(doc, "x.pfproj", "0.2.0", null);
  const frame = decodeFrame<ProjectHeader>(encodeFrame(header as unknown as Record<string, unknown>, blobs));
  return { back: documentFromProjectFrame(frame), manifest: header.manifest };
}

describe("pfproj format 2", () => {
  it("writes format 2 with every new layer field and reads it back", () => {
    const doc = createDocument({ name: "V2", width: 8, height: 6, background: "white" });
    const bg = doc.layers[0] as RasterLayer;
    bg.fillOpacity = 0.5;
    bg.lock = { transparent: true, pixels: false, position: true, all: false };
    bg.color = "blue";
    bg.effects = { dropShadow: defaultDropShadow({ distance: 3 }), stroke: defaultStroke({ size: 2 }) };
    const top = createRasterLayer(doc, { name: "top", clipToBelow: true, maskEnabled: false, maskLinked: false });
    top.mask = Raster.filled(8, 6, rgba(128, 128, 128));
    top.linkedTo = [bg.id];
    bg.linkedTo = [top.id];
    addLayer(doc, top);
    const { back, manifest } = roundTrip(doc);
    expect(manifest.format).toBe(PFPROJ_FORMAT);
    const m0 = manifest.layers[0]!;
    expect(m0.fill_opacity).toBe(0.5);
    expect(m0.lock).toEqual({ transparent: true, pixels: false, position: true, all: false });
    expect(m0.color).toBe("blue");
    expect(m0.effects?.dropShadow?.distance).toBe(3);
    expect(manifest.layers[1]!.clip_to_below).toBe(true);
    expect(manifest.layers[1]!.mask_enabled).toBe(false);
    const b0 = back.layers[0]!;
    const b1 = back.layers[1]!;
    expect(b0.fillOpacity).toBe(0.5);
    expect(b0.lock).toEqual({ transparent: true, pixels: false, position: true, all: false });
    expect(b0.color).toBe("blue");
    expect(b0.effects).toEqual(bg.effects);
    expect(b0.linkedTo).toEqual([top.id]);
    expect(b1.linkedTo).toEqual([bg.id]);
    expect(b1.clipToBelow).toBe(true);
    expect(b1.maskEnabled).toBe(false);
    expect(b1.maskLinked).toBe(false);
    expect(b1.mask!.getPixel(0, 0).r).toBe(128);
  });

  it("round-trips adjustment, fill (solid / gradient / pattern), shape and text layers and groups", () => {
    const doc = createDocument({ name: "Kinds", width: 16, height: 16, background: "white" });
    const adj = createAdjustmentLayer(doc, { op: "hue-saturation", params: { saturation: -40 } });
    addLayer(doc, adj);
    const solid = createFillLayer(doc, { fill: solidFill(rgba(1, 2, 3, 200)), opacity: 0.3 });
    addLayer(doc, solid);
    const grad = createFillLayer(doc, { fill: gradientFill([{ pos: 0, color: rgba(0, 0, 0) }, { pos: 1, color: rgba(255, 255, 255) }], { style: "radial", angle: 45, scale: 1.5, reverse: true }) });
    addLayer(doc, grad);
    const tile = new Raster(2, 2);
    tile.setPixel(0, 0, rgba(9, 8, 7));
    const pat = createFillLayer(doc, { fill: patternFill(tile, { scale: 2, offset: { x: 1, y: 0 } }) });
    pat.mask = Raster.filled(16, 16, rgba(255, 255, 255));
    addLayer(doc, pat);
    const shape = createShapeLayer(doc, {
      path: rectPath(Rect.make(2, 2, 6, 6)),
      fill: solidFill(rgba(0, 0, 255)),
      stroke: { width: 1, fill: solidFill(rgba(255, 0, 0)), position: "inside", cap: "round", join: "bevel", dash: [2, 1] },
      fillRule: "evenodd",
    });
    addLayer(doc, shape);
    const text = createTextLayer(doc, { text: textSpec("Hi", 2, 12, { size: 8, bold: true, tracking: 50, align: "center" }) });
    addLayer(doc, text);
    const group = createGroupLayer(doc, { name: "G", passThrough: false });
    doc.layers.push(group);
    const child = createRasterLayer(doc, { name: "child", parentId: group.id, blendMode: BlendMode.Screen });
    doc.layers.push(child);
    doc.activeLayerId = text.id;
    const before = compositeToRaster(doc);

    const { back, manifest } = roundTrip(doc);
    expect(manifest.layers.map((l) => l.kind)).toEqual(["raster", "adjustment", "fill", "fill", "fill", "shape", "text", "raster", "group"]);
    expect(manifest.layers[1]!.adjustment).toEqual({ op: "hue-saturation", params: adj.params });
    expect(manifest.layers[4]!.fill?.type).toBe("pattern");
    expect((manifest.layers[4]!.fill as { pattern: { rgba: string } }).pattern.rgba.length).toBeGreaterThan(0);
    expect(manifest.layers[8]!.pass_through).toBe(false);
    // Shape / text entries also carry cached pixels for old readers.
    expect(manifest.layers[5]!.width).toBe(16);
    expect(manifest.layers[6]!.width).toBe(16);

    expect(back.layers.map((l) => l.kind)).toEqual(["raster", "adjustment", "fill", "fill", "fill", "shape", "text", "group", "raster"]);
    const bAdj = back.layers[1] as AdjustmentLayer;
    expect(bAdj.op).toBe("hue-saturation");
    expect(bAdj.params.saturation).toBe(-40);
    const bSolid = back.layers[2] as FillLayer;
    expect(bSolid.fill).toEqual(solidFill(rgba(1, 2, 3, 200)));
    expect(bSolid.opacity).toBeCloseTo(0.3);
    const bGrad = back.layers[3] as FillLayer;
    expect(bGrad.fill).toEqual(grad.fill);
    const bPat = back.layers[4] as FillLayer;
    expect(bPat.fill.type).toBe("pattern");
    if (bPat.fill.type === "pattern") {
      expect(bPat.fill.scale).toBe(2);
      expect(bPat.fill.offset).toEqual({ x: 1, y: 0 });
      expect(bPat.fill.pattern.getPixel(0, 0)).toEqual(rgba(9, 8, 7));
    }
    expect(bPat.mask).not.toBeNull();
    const bShape = back.layers[5] as ShapeLayer;
    expect(bShape.path).toEqual(shape.path);
    expect(bShape.fill).toEqual(shape.fill);
    expect(bShape.stroke).toEqual(shape.stroke);
    expect(bShape.fillRule).toBe("evenodd");
    expect(bShape.raster.equals(shape.raster)).toBe(true);
    const bText = back.layers[6] as TextLayer;
    expect(bText.text).toEqual(text.text);
    expect(bText.raster.equals(text.raster)).toBe(true);
    expect(back.layers[7]!.kind).toBe("group");
    expect((back.layers[7] as { passThrough: boolean }).passThrough).toBe(false);
    expect(back.layers[8]!.parentId).toBe(back.layers[7]!.id);
    expect(back.activeLayerId).toBe(text.id);
    expect(compositeToRaster(back).equals(before)).toBe(true);
  });

  it("round-trips alpha channels, paths and the work path", () => {
    const doc = createDocument({ name: "C", width: 6, height: 5 });
    doc.selection = Selection.fromRect(6, 5, Rect.make(1, 1, 2, 2));
    const ch = saveSelectionAsChannel(doc, "Saved");
    ch.color = rgba(0, 255, 0, 255);
    ch.opacity = 0.7;
    doc.alphaChannels.push(ch);
    const p = rectPath(Rect.make(0, 0, 3, 3), "Work Path");
    doc.paths = [p];
    doc.workPathId = p.id;
    const { header, blobs } = projectFrameParts(doc, "c.pfproj", "0.2.0", null);
    expect(header.channels).toHaveLength(1);
    expect(header.manifest.channels).toEqual([{ id: ch.id, name: "Saved", color: [0, 255, 0], opacity: 0.7, file: `channels/${ch.id}.png` }]);
    expect(blobs[header.channels![0]!.blob]!.byteLength).toBe(30);
    expect(header.manifest.paths).toHaveLength(1);
    expect(header.manifest.work_path).toBe(p.id);
    const back = documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(header as unknown as Record<string, unknown>, blobs)));
    expect(back.alphaChannels).toHaveLength(1);
    expect(back.alphaChannels[0]!.name).toBe("Saved");
    expect(back.alphaChannels[0]!.color).toEqual(rgba(0, 255, 0, 255));
    expect(back.alphaChannels[0]!.opacity).toBe(0.7);
    expect(back.alphaChannels[0]!.mask.getPixel(1, 1).r).toBe(255);
    expect(back.alphaChannels[0]!.mask.getPixel(4, 4).r).toBe(0);
    expect(back.paths).toEqual([p]);
    expect(back.workPathId).toBe(p.id);
    expect(back.meta.manifestExtra).toEqual({});
  });

  it("reads format 1 files with defaults for every new field", () => {
    const px = new Uint8Array(2 * 2 * 4).fill(7);
    const manifest: Manifest = {
      format: 1,
      app_version: "0.1.0",
      created: "",
      modified: "",
      doc: { id: "d1", name: "Old", width: 2, height: 2 },
      layers: [
        { id: "a", name: "A", kind: "raster", parent: null, x: 0, y: 0, width: 2, height: 2, opacity: 1, blend_mode: "normal", visible: true, locked: true },
        { id: "g", name: "G", kind: "group", parent: null, x: 0, y: 0, width: 0, height: 0, opacity: 1, blend_mode: "normal", visible: true, locked: false },
      ],
      active_layer: "a",
      ai_history: [],
      future_thing: { keep: true },
    };
    const header: ProjectHeader = { path: "old.pfproj", manifest, layers: [{ id: "a", width: 2, height: 2, blob: 0, encoding: "rgba" }], blobs: [px.byteLength] };
    const doc = documentFromProjectFrame({ header, blobs: [px] });
    const a = doc.layers[0]!;
    expect(a.kind).toBe("raster");
    expect(a.locked).toBe(true);
    expect(a.lock).toEqual({ transparent: false, pixels: false, position: false, all: true });
    expect(a.fillOpacity).toBe(1);
    expect(a.maskEnabled).toBe(true);
    expect(a.maskLinked).toBe(true);
    expect(a.clipToBelow).toBe(false);
    expect(a.effects).toBeNull();
    expect(a.linkedTo).toEqual([]);
    expect(a.color).toBeNull();
    const g = doc.layers[1]!;
    expect(g.kind).toBe("group");
    expect((g as { passThrough: boolean }).passThrough).toBe(true);
    expect(doc.alphaChannels).toEqual([]);
    expect(doc.paths).toEqual([]);
    expect(doc.workPathId).toBeNull();
    expect(doc.quickMask.active).toBe(false);
    expect(doc.meta.manifestExtra).toEqual({ future_thing: { keep: true } });
    // Re-saving upgrades to format 2 and keeps the unknown field.
    const { header: h2 } = projectFrameParts(doc, "old.pfproj", "0.2.0", null);
    expect(h2.manifest.format).toBe(2);
    expect(h2.manifest.future_thing).toEqual({ keep: true });
  });

  it("refuses newer formats and tolerates unknown kinds / broken specs", () => {
    const manifest: Manifest = {
      format: 99,
      app_version: "",
      created: "",
      modified: "",
      doc: { id: "d", name: "N", width: 2, height: 2 },
      layers: [],
      active_layer: null,
      ai_history: [],
    };
    expect(() => documentFromProjectFrame({ header: { path: "", manifest, layers: [], blobs: [] }, blobs: [] })).toThrow(/newer/);
    manifest.format = 2;
    manifest.layers = [
      { id: "s", name: "S", kind: "shape", parent: null, x: 0, y: 0, width: 2, height: 2, opacity: 1, blend_mode: "normal", visible: true, locked: false },
      { id: "w", name: "W", kind: "weird" as never, parent: null, x: 0, y: 0, width: 2, height: 2, opacity: 1, blend_mode: "normal", visible: true, locked: false },
    ];
    const px = new Uint8Array(16).fill(3);
    const doc = documentFromProjectFrame({ header: { path: "", manifest, layers: [{ id: "s", width: 2, height: 2, blob: 0 }], blobs: [16] }, blobs: [px] });
    // A shape without a spec falls back to its cached pixels as a raster layer.
    expect(doc.layers[0]!.kind).toBe("raster");
    expect((doc.layers[0] as RasterLayer).raster.getPixel(0, 0).r).toBe(3);
    expect(doc.layers[1]!.kind).toBe("raster");
  });

  it("base64 helpers round-trip bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes("!!!not base64!!!").byteLength).toBe(0);
  });
});
