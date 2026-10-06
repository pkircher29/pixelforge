import { describe, expect, it } from "vitest";
import {
  blendFromFile,
  blendToFile,
  groupsBeforeChildren,
  childrenBeforeGroups,
  documentFromOpenFrame,
  documentFromProjectFrame,
  projectFrameParts,
  baseName,
  extensionOf,
  type OpenHeader,
  type ProjectHeader,
} from "../lib/io/convert";
import { decodeFrame, encodeFrame } from "../lib/io/frame";
import { BlendMode, Raster, Rect, Selection, createDocument, createGroupLayer, createRasterLayer, type RasterLayer } from "../lib/engine";

describe("blend names", () => {
  it("round-trips hyphen ↔ underscore", () => {
    expect(blendToFile(BlendMode.ColorDodge)).toBe("color_dodge");
    expect(blendFromFile("color_dodge")).toBe(BlendMode.ColorDodge);
    expect(blendFromFile("hard-light")).toBe(BlendMode.HardLight);
    expect(blendFromFile("vivid_light")).toBe(BlendMode.Normal);
    expect(blendFromFile(undefined)).toBe(BlendMode.Normal);
  });
});

describe("group ordering", () => {
  it("moves group entries before their children (file → engine)", () => {
    const items = [
      { n: "bg", g: null as number | null, group: false },
      { n: "c1", g: 3, group: false },
      { n: "c2", g: 3, group: false },
      { n: "G", g: null, group: true },
      { n: "top", g: null, group: false },
    ];
    const out = groupsBeforeChildren(items, (x) => x.group, (x) => x.g).map((x) => x.n);
    expect(out).toEqual(["bg", "G", "c1", "c2", "top"]);
  });

  it("moves children before groups (engine → file) and round-trips", () => {
    const doc = createDocument({ width: 4, height: 4, noBackgroundLayer: true });
    const bg = createRasterLayer(doc, { name: "bg" });
    const g = createGroupLayer(doc, { name: "G" });
    const c1 = createRasterLayer(doc, { name: "c1", parentId: g.id });
    const top = createRasterLayer(doc, { name: "top" });
    doc.layers = [bg, g, c1, top];
    const file = childrenBeforeGroups(doc.layers).map((l) => l.name);
    expect(file).toEqual(["bg", "c1", "G", "top"]);
  });
});

describe("documentFromOpenFrame", () => {
  it("builds layers with offsets, blend modes and group parents", () => {
    const px = new Uint8Array(2 * 2 * 4).fill(200);
    const header: OpenHeader = {
      width: 10,
      height: 8,
      sourceFormat: "psd",
      layers: [
        { name: "Background", x: 0, y: 0, w: 2, h: 2, opacity: 1, visible: true, blendMode: "normal", isGroup: false, groupDepth: 0, group: null, blob: 0 },
        { name: "Child", x: 3, y: 4, w: 2, h: 2, opacity: 0.5, visible: false, blendMode: "color_burn", isGroup: false, groupDepth: 1, group: 2, blob: 1 },
        { name: "Folder", x: 0, y: 0, w: 0, h: 0, opacity: 1, visible: true, blendMode: "normal", isGroup: true, groupDepth: 0, group: null, blob: null },
      ],
      blobs: [px.byteLength, px.byteLength],
    };
    const doc = documentFromOpenFrame({ header, blobs: [px, px] }, "poster");
    expect(doc.name).toBe("poster");
    expect(doc.width).toBe(10);
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "Folder", "Child"]);
    const child = doc.layers[2] as RasterLayer;
    expect(child.parentId).toBe(doc.layers[1]!.id);
    expect(child.offset).toEqual({ x: 3, y: 4 });
    expect(child.blendMode).toBe(BlendMode.ColorBurn);
    expect(child.visible).toBe(false);
    expect(child.raster.getPixel(0, 0).r).toBe(200);
    expect(doc.activeLayerId).toBe(child.id);
    expect(doc.meta.sourceFormat).toBe("psd");
  });

  it("falls back to an empty layer when the blob size is wrong", () => {
    const header: OpenHeader = {
      width: 4,
      height: 4,
      sourceFormat: "png",
      layers: [{ name: "B", x: 0, y: 0, w: 4, h: 4, opacity: 1, visible: true, blendMode: "normal", isGroup: false, groupDepth: 0, group: null, blob: 0 }],
      blobs: [3],
    };
    const doc = documentFromOpenFrame({ header, blobs: [new Uint8Array(3)] }, "x");
    expect((doc.layers[0] as RasterLayer).raster.width).toBe(4);
  });
});

describe("pfproj round trip", () => {
  it("projectFrameParts → documentFromProjectFrame preserves structure, pixels, selection and ai_history", () => {
    const doc = createDocument({ name: "Round", width: 6, height: 5, noBackgroundLayer: true });
    const bg = createRasterLayer(doc, { name: "bg" });
    bg.raster.fill({ r: 1, g: 2, b: 3, a: 255 });
    const g = createGroupLayer(doc, { name: "G", opacity: 0.7 });
    const c = createRasterLayer(doc, { name: "c", parentId: g.id, offset: { x: 1, y: 2 }, blendMode: BlendMode.Screen, raster: new Raster(3, 2), locked: true });
    c.raster.fill({ r: 9, g: 9, b: 9, a: 128 });
    doc.layers = [bg, g, c];
    doc.activeLayerId = c.id;
    doc.selection = Selection.fromRect(6, 5, Rect.make(1, 1, 2, 2));
    doc.meta.ai_history = [{ provider: "x_ai", prompt: "hi" }];

    const { header, blobs } = projectFrameParts(doc, "C:/x/round.pfproj", "0.1.0", null);
    expect(header.manifest.layers.map((l) => l.name)).toEqual(["bg", "c", "G"]);
    expect(header.manifest.layers[1]!.parent).toBe(g.id);
    expect(header.manifest.layers[1]!.blend_mode).toBe("screen");
    expect(header.layers).toHaveLength(2);
    expect(header.selection).toBeDefined();

    // Simulate the Rust side echoing the frame back.
    const bytes = encodeFrame(header as unknown as Record<string, unknown>, blobs);
    const frame = decodeFrame<ProjectHeader>(bytes);
    const back = documentFromProjectFrame(frame);
    expect(back.width).toBe(6);
    expect(back.layers.map((l) => l.name)).toEqual(["bg", "G", "c"]);
    const bc = back.layers[2] as RasterLayer;
    expect(bc.parentId).toBe(back.layers[1]!.id);
    expect(bc.offset).toEqual({ x: 1, y: 2 });
    expect(bc.blendMode).toBe(BlendMode.Screen);
    expect(bc.locked).toBe(true);
    expect(bc.raster.getPixel(0, 0)).toEqual({ r: 9, g: 9, b: 9, a: 128 });
    expect(back.layers[1]!.opacity).toBeCloseTo(0.7);
    expect(back.selection.bbox).toEqual(Rect.make(1, 1, 2, 2));
    expect(back.activeLayerId).toBe(bc.id);
    expect(back.meta.ai_history).toEqual([{ provider: "x_ai", prompt: "hi" }]);
  });

  it("writes a thumbnail blob when given", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const { header, blobs } = projectFrameParts(doc, "p.pfproj", "0.1.0", Raster.filled(2, 2, { r: 0, g: 0, b: 0, a: 255 }));
    expect(header.thumbnail).toMatchObject({ width: 2, height: 2 });
    expect(blobs[header.thumbnail!.blob]!.byteLength).toBe(16);
    expect(header.manifest.thumbnail).toBe("thumb.png");
  });
});

describe("path helpers", () => {
  it("extracts base names and extensions", () => {
    expect(baseName("C:\\art\\poster.final.PNG")).toBe("poster.final");
    expect(baseName("/tmp/noext")).toBe("noext");
    expect(extensionOf("C:/a/b.PfProj")).toBe("pfproj");
    expect(extensionOf("plain")).toBe("");
  });
});
