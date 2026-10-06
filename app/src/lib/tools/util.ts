/** Small helpers shared by tools. */
import { Rect, activeLayer, compositeToRaster, Raster, type Document, type Point, type RasterLayer, type Viewport } from "$lib/engine";
import type { ToolContext } from "./types";

/** The active raster layer, or null (with a user-facing reason) when it can't be painted. */
export function paintableLayer(ctx: ToolContext, action = "paint"): RasterLayer | null {
  const l = activeLayer(ctx.doc);
  if (!l) {
    ctx.notify("info", "Add a layer first.");
    return null;
  }
  if (l.kind !== "raster") {
    ctx.notify("info", `Select a pixel layer to ${action} — groups hold no pixels.`);
    return null;
  }
  if (l.locked) {
    ctx.notify("info", `"${l.name}" is locked. Unlock it in the Layers panel to ${action}.`);
    return null;
  }
  if (!l.visible) {
    ctx.notify("info", `"${l.name}" is hidden. Show it to ${action}.`);
    return null;
  }
  return l;
}

/** Document point → layer raster space. */
export function toLayerSpace(layer: RasterLayer, p: Point): Point {
  return { x: p.x - layer.offset.x, y: p.y - layer.offset.y };
}

/** Screen rect (CSS px) for a doc rect through the viewport (axis-aligned, rotation 0). */
export function docRectToScreen(vp: Viewport, r: Rect): Rect {
  const a = vp.docToScreen({ x: r.x, y: r.y });
  const b = vp.docToScreen({ x: r.x + r.w, y: r.y + r.h });
  return Rect.fromPoints(a, b);
}

/** Round a doc rect to whole pixels and clamp to the document. */
export function clampDocRect(doc: Document, r: Rect): Rect {
  return Rect.intersect(Rect.roundOut(r), Rect.ofSize(doc.width, doc.height));
}

/** Crisp 1px dashed outline with a dark halo so it reads on any background. */
export function strokeOutline(g: CanvasRenderingContext2D, path: () => void, opts: { dash?: number[]; phase?: number } = {}): void {
  g.save();
  g.lineWidth = 1;
  g.setLineDash([]);
  g.strokeStyle = "rgba(0,0,0,0.55)";
  path();
  g.stroke();
  g.setLineDash(opts.dash ?? [4, 4]);
  g.lineDashOffset = -(opts.phase ?? 0);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  path();
  g.stroke();
  g.restore();
}

/** Square handle centred at a screen point. */
export function drawHandle(g: CanvasRenderingContext2D, x: number, y: number, size = 7, active = false): void {
  g.save();
  g.fillStyle = active ? "#8b6cff" : "#ffffff";
  g.strokeStyle = "rgba(0,0,0,0.7)";
  g.lineWidth = 1;
  g.beginPath();
  g.rect(Math.round(x - size / 2) + 0.5, Math.round(y - size / 2) + 0.5, size, size);
  g.fill();
  g.stroke();
  g.restore();
}

/** Cached document-sized scratch raster for point sampling the composite. */
export class CompositeSampler {
  private scratch: Raster | null = null;

  /** Composite colour at a doc pixel (RGBA 0..255). */
  sample(doc: Document, x: number, y: number): { r: number; g: number; b: number; a: number } {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return { r: 0, g: 0, b: 0, a: 0 };
    if (!this.scratch || this.scratch.width !== doc.width || this.scratch.height !== doc.height) {
      this.scratch = new Raster(doc.width, doc.height);
    }
    compositeToRaster(doc, { rect: Rect.make(px, py, 1, 1), into: this.scratch });
    return this.scratch.getPixel(px, py);
  }
}
