import { BlendMode, GlCompositor, Raster, Rect, Viewport, addLayer, compositeToRaster, createDocument, createRasterLayer, groupLayers, rgba } from "../../../lib/engine";
import { CanvasCompositor } from "../../../lib/engine/composite/CanvasCompositor";

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
  result.textContent = `PASS\n${checks.join("\n")}`;
} catch (e) { result.textContent = `FAIL: ${e}`; throw e; }
finally { comp.dispose(); }
