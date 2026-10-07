import { BlendMode, GlCompositor, Raster, Rect, Viewport, addLayer, compositeToRaster, createDocument, createRasterLayer, groupLayers, rgba } from "../../../lib/engine";

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
  result.textContent = `PASS\n${checks.join("\n")}`;
} catch (e) { result.textContent = `FAIL: ${e}`; throw e; }
finally { comp.dispose(); }
