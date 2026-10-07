import { BlendMode, GlCompositor, Raster, Rect, TiledRaster, Viewport, addLayer, compositeToRaster, createDocument, createRasterLayer, groupLayers, rgba } from "../../../lib/engine";
import { CanvasCompositor } from "../../../lib/engine/composite/CanvasCompositor";
import { documentFromProjectFrame, projectFrameParts, type ProjectHeader } from "../../../lib/io/convert";
import { decodeFrame, encodeFrame } from "../../../lib/io/frame";
import { BrushStroke, DEFAULT_BRUSH_SETTINGS } from "../../../lib/tools/brush-engine";

const result = document.querySelector<HTMLPreElement>("#result")!;
const comp = new GlCompositor(document.querySelector<HTMLCanvasElement>("#canvas")!);
try {
  const doc = createDocument({ width: 32, height: 24, background: "white" });
  const child = createRasterLayer(doc);
  child.raster.fill(rgba(0, 0, 255), Rect.make(2, 2, 12, 18));
  addLayer(doc, child);
  const group = groupLayers(doc, [child.id]);
  const top = createRasterLayer(doc, { raster: Raster.filled(32, 24, rgba(0, 255, 0)), clipToBelow: true });
  addLayer(doc, top);
  const view = new Viewport().fitToView(320, 240, 32, 24);
  const checks: string[] = [];
  function check(label: string) {
    comp.render(doc, view, { showSelection: false, showPixelGrid: false });
    const gpu = comp.readComposite()!, cpu = compositeToRaster(doc);
    let maxError = 0;
    for (let i = 0; i < cpu.data.length; i++) maxError = Math.max(maxError, Math.abs(cpu.data[i]! - gpu.data[i]!));
    if (maxError > 2) throw new Error(`${label}: pixel difference ${maxError}`);
    checks.push(`${label}: max difference ${maxError}`);
  }
  check("group silhouette");
  group.opacity = 0.5; check("group opacity");
  group.blendMode = BlendMode.Multiply; check("group blend mode");
  group.mask = Raster.filled(32, 24, rgba(0, 0, 0));
  group.mask.fill(rgba(255, 255, 255), Rect.make(0, 0, 8, 24));
  check("group mask");
  child.raster.fill(rgba(255, 0, 0), Rect.make(18, 1, 8, 8));
  comp.markDirty(child.id); check("child edit invalidation");
  group.maskEnabled = false; check("disabled group mask");
  top.visible = false; check("hidden clipped layer");
  top.visible = true; group.visible = false; check("hidden group hides chain");
  const colorDoc = createDocument({ width: 32, height: 24, background: "white" });
  addLayer(colorDoc, createRasterLayer(colorDoc, { raster: Raster.filled(32, 24, rgba(100, 150, 200)) }));
  const gl = document.querySelector<HTMLCanvasElement>("#canvas")!.getContext("webgl2")!;
  for (const [channel, expected] of [["rg", [100, 150, 0]], ["rb", [100, 0, 200]], ["gb", [0, 150, 200]], ["none", [0, 0, 0]]] as const) {
    comp.render(colorDoc, view, { viewChannel: channel, showPixelGrid: false, showSelection: false });
    const pixel = new Uint8Array(4);
    gl.readPixels(160, 120, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (expected.some((value, i) => Math.abs(value - pixel[i]!) > 1)) throw new Error(`${channel}: unexpected display pixel ${pixel}`);
    checks.push(`${channel} channel display: ${pixel.slice(0, 3)}`);
  }
  result.textContent = `PASS\n${checks.join("\n")}`;
  const alpha = { id: "overlay-test", name: "Overlay", mask: Raster.filled(32, 24, rgba(0, 0, 0)), color: rgba(255, 0, 0), opacity: 0.5 };
  colorDoc.alphaChannels.push(alpha);
  function checkOverlay(label: string, expected: number[]) {
    comp.render(colorDoc, view, { alphaOverlayIds: [alpha.id], showPixelGrid: false, showSelection: false });
    const pixel = new Uint8Array(4); gl.readPixels(160, 120, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (expected.some((value, i) => Math.abs(value - pixel[i]!) > 1)) throw new Error(`${label}: ${pixel}`);
    checks.push(`${label}: ${pixel.slice(0, 3)}`);
  }
  checkOverlay("alpha tint", [178, 75, 100]);
  alpha.color = rgba(0, 0, 255); checkOverlay("alpha color change", [50, 75, 228]);
  alpha.mask.fill(rgba(255, 255, 255)); comp.markDirty(`@channel:${alpha.id}`);
  checkOverlay("alpha paint invalidation", [100, 150, 200]);
  const canvas2d = document.createElement("canvas"); canvas2d.width = 320; canvas2d.height = 240;
  const cpuDisplay = new CanvasCompositor(canvas2d);
  alpha.mask.fill(rgba(0, 0, 0));
  cpuDisplay.render(colorDoc, view, { alphaOverlayIds: [alpha.id], showPixelGrid: false, showSelection: false });
  const cpuPixel = canvas2d.getContext("2d")!.getImageData(160, 120, 1, 1).data;
  if ([50, 75, 228].some((value, i) => Math.abs(value - cpuPixel[i]!) > 1)) throw new Error(`Canvas alpha tint: ${cpuPixel}`);
  checks.push(`Canvas alpha tint: ${cpuPixel.slice(0, 3)}`);
  cpuDisplay.dispose();
  const tiledDoc = createDocument({ width: 530, height: 270, background: "transparent" });
  const tiledLayer = tiledDoc.layers[0]!;
  const tiled = tiledLayer.raster as TiledRaster;
  tiled.fill(rgba(25, 150, 230), Rect.make(250, 250, 20, 20));
  tiled.setPixel(529, 269, rgba(255, 90, 20));
  const tiledView = new Viewport().fitToView(320, 240, 530, 270);
  function checkTiles(label: string) {
    const stats = comp.render(tiledDoc, tiledView, { showSelection: false, showPixelGrid: false });
    const gpu = comp.readComposite()!, cpu = compositeToRaster(tiledDoc);
    const a = gpu.data, b = cpu.data;
    // GPU readback unpremultiplies RGBA8; low-alpha straight RGB amplifies rounding.
    const mismatch = a.findIndex((v, i) => {
      if (i % 4 === 3) return Math.abs(v - b[i]!) > 2;
      const alphaIndex = i - i % 4 + 3;
      return Math.abs(v * a[alphaIndex]! / 255 - b[i]! * b[alphaIndex]! / 255) > 2;
    });
    if (mismatch >= 0) throw new Error(`${label}: GPU/CPU tile mismatch at byte ${mismatch}: ${a.slice(mismatch - mismatch % 4, mismatch - mismatch % 4 + 4)} / ${b.slice(mismatch - mismatch % 4, mismatch - mismatch % 4 + 4)}`);
    if (tiled.storageMode !== "tiled") throw new Error(`${label}: source was materialized`);
    checks.push(`${label}: pixel parity; source remains tiled; ${stats.uploads} uploads`);
    return stats;
  }
  checkTiles("sparse edge-tile upload");
  const expectedSaved = comp.readComposite()!.data;
  const saved = projectFrameParts(tiledDoc, "browser-tiled.pfproj", "0.3.0", null);
  const reopened = documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(saved.header as unknown as Record<string, unknown>, saved.blobs)));
  comp.render(reopened, tiledView, { showSelection: false, showPixelGrid: false });
  if (comp.readComposite()!.data.some((v, i) => Math.abs(v - expectedSaved[i]!) > 2)) throw new Error("reopened tile pixels changed");
  if (tiled.storageMode !== "tiled" || (reopened.layers[0]!.raster as TiledRaster).storageMode !== "tiled") throw new Error("project frames expanded tiled storage");
  checks.push("project frame reopen: GPU pixel parity; live and restored sources remain tiled");
  comp.render(tiledDoc, tiledView, { showSelection: false, showPixelGrid: false });
  tiled.fill(rgba(240, 10, 30), Rect.make(254, 254, 4, 4));
  comp.markDirty(tiledLayer.id, Rect.make(254, 254, 4, 4));
  if (checkTiles("cross-tile dirty update").uploads !== 4) throw new Error("dirty update must upload four intersected tile regions");
  tiled.clear(Rect.make(512, 256, 18, 14));
  comp.markDirty(tiledLayer.id, Rect.make(512, 256, 18, 14));
  checkTiles("removed edge tile clears GPU pixels");
  tiled.clear(); comp.markDirty(tiledLayer.id);
  checkTiles("full sparse clear resets texture");
  const stroke = new BrushStroke(tiled, {
    settings: { ...DEFAULT_BRUSH_SETTINGS, size: 24 },
    blend: { mode: "color", color: rgba(230, 60, 110) },
    opacity: 0.7, flow: 0.5, selection: null, offset: { x: 0, y: 0 }, seed: 1,
  });
  stroke.moveTo({ x: 250, y: 250 });
  stroke.moveTo({ x: 270, y: 260 });
  comp.markDirty(tiledLayer.id, Rect.make(230, 230, 60, 40));
  checkTiles("brush crosses tile boundary");
  const restored = stroke.abort();
  if (restored) comp.markDirty(tiledLayer.id, restored);
  checkTiles("brush cancellation restores GPU pixels");
  if (tiled.byteLength() !== 0) throw new Error("cancelled brush retained painted tiles");
  result.textContent = `PASS\n${checks.join("\n")}`;
} catch (e) { result.textContent = `FAIL: ${e}`; throw e; }
finally { comp.dispose(); }
