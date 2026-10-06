/**
 * Dev-only demo: builds a 3-layer document with different blend modes, mounts a
 * compositor on a canvas and runs a render loop with pan/zoom and marching ants.
 * Not wired into App.svelte; import `mountDemo` or the `Demo.svelte` component.
 */

import { Rect } from "../rect";
import { Raster } from "../raster";
import { Selection } from "../selection";
import { createDocument, createRasterLayer, addLayer, getPixelLayer, createAdjustmentLayer, createShapeLayer, createTextLayer } from "../document";
import { History } from "../history";
import { PaintCommand } from "../commands/paint";
import { BlendMode, type Document, type ICompositor, type RenderStats } from "../types";
import { Viewport } from "../viewport";
import { createCompositor } from "../composite";
import { defaultDropShadow, defaultStroke } from "../ops/effects";
import { ellipsePath, roundedRectPath } from "../ops/vector";
import { textSpec } from "../ops/text";
import { solidFill } from "../ops/fill";

/** Fill a raster with a two-colour diagonal gradient. */
function gradient(r: Raster, a: [number, number, number], b: [number, number, number]): void {
  const d = r.data;
  const w = r.width;
  const h = r.height;
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const t = (x / w + y / h) / 2;
      d[i] = a[0] + (b[0] - a[0]) * t;
      d[i + 1] = a[1] + (b[1] - a[1]) * t;
      d[i + 2] = a[2] + (b[2] - a[2]) * t;
      d[i + 3] = 255;
    }
  }
}

/** Anti-aliased filled disc with a soft edge. */
function disc(r: Raster, cx: number, cy: number, radius: number, rgb: [number, number, number], soft = 2): void {
  const d = r.data;
  const w = r.width;
  const x0 = Math.max(0, Math.floor(cx - radius - soft));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius + soft));
  const y0 = Math.max(0, Math.floor(cy - radius - soft));
  const y1 = Math.min(r.height - 1, Math.ceil(cy + radius + soft));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.max(0, Math.min(1, (radius - dist) / soft + 0.5));
      if (a <= 0) continue;
      const i = (y * w + x) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = a * 255;
    }
  }
}

function stripes(r: Raster, period: number, rgb: [number, number, number]): void {
  const d = r.data;
  const w = r.width;
  let i = 0;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const on = Math.floor((x + y) / period) % 2 === 0;
      if (!on) continue;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    }
  }
}

/**
 * A 640x480 document exercising the v2 layer system: gradient background, a Multiply
 * disc, **masked** Screen stripes (soft radial mask), a Hue disc with a **clipped**
 * texture layer, a **Hue/Saturation adjustment layer** (masked to the left half), a
 * rounded-rectangle **shape layer** with an outside stroke, and a **text layer** with a
 * drop shadow + stroke layer style.
 */
export function buildDemoDocument(): Document {
  const doc = createDocument({ name: "Demo", width: 640, height: 480, noBackgroundLayer: true });
  const bg = createRasterLayer(doc, { name: "Background" });
  gradient(bg.raster, [40, 60, 120], [240, 200, 120]);
  addLayer(doc, bg);

  const mul = createRasterLayer(doc, { name: "Multiply disc", blendMode: BlendMode.Multiply });
  disc(mul.raster, 240, 220, 150, [255, 80, 160]);
  addLayer(doc, mul);

  // Masked layer: stripes revealed through a soft radial mask.
  const scr = createRasterLayer(doc, { name: "Screen stripes (masked)", blendMode: BlendMode.Screen, opacity: 0.7 });
  stripes(scr.raster, 24, [60, 220, 255]);
  const mask = new Raster(doc.width, doc.height);
  disc(mask, 240, 220, 170, [255, 255, 255], 60);
  for (let i = 0; i < mask.data.length; i += 4) {
    const v = mask.data[i + 3]!;
    mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = v;
    mask.data[i + 3] = 255;
  }
  scr.mask = mask;
  addLayer(doc, scr);

  const hue = createRasterLayer(doc, {
    name: "Hue disc (offset)",
    blendMode: BlendMode.Hue,
    raster: new Raster(260, 260),
    offset: { x: 330, y: 170 },
  });
  disc(hue.raster, 130, 130, 120, [40, 255, 60]);
  addLayer(doc, hue);

  // Clipped layer: diagonal stripes only inside the hue disc.
  const clipped = createRasterLayer(doc, { name: "Stripes (clipped to disc)", clipToBelow: true, opacity: 0.8 });
  stripes(clipped.raster, 12, [255, 255, 255]);
  addLayer(doc, clipped);

  // Adjustment layer: desaturate the left half (masked).
  const adj = createAdjustmentLayer(doc, { op: "hue-saturation", params: { saturation: -80 }, name: "Hue/Saturation (left half)" });
  const adjMask = new Raster(doc.width, doc.height);
  adjMask.fill({ r: 255, g: 255, b: 255, a: 255 }, Rect.make(0, 0, 320, doc.height));
  adjMask.fill({ r: 0, g: 0, b: 0, a: 255 }, Rect.make(320, 0, 320, doc.height));
  adj.mask = adjMask;
  addLayer(doc, adj);

  // Shape layer with an outside stroke.
  const shape = createShapeLayer(doc, {
    name: "Rounded rect (shape)",
    path: roundedRectPath(Rect.make(40, 320, 220, 120), 24),
    fill: solidFill({ r: 255, g: 220, b: 80, a: 200 }),
    stroke: { width: 6, fill: solidFill({ r: 30, g: 30, b: 60, a: 255 }), position: "outside", cap: "round", join: "round", dash: null },
  });
  addLayer(doc, shape);
  const ring = createShapeLayer(doc, {
    name: "Ring (stroke only)",
    path: ellipsePath(Rect.make(470, 40, 130, 130)),
    fill: null,
    stroke: { width: 8, fill: solidFill({ r: 255, g: 255, b: 255, a: 255 }), position: "center", cap: "butt", join: "miter", dash: [18, 10] },
  });
  addLayer(doc, ring);

  // Text layer with drop shadow + stroke.
  const text = createTextLayer(doc, {
    name: "Pixelforge (type)",
    text: textSpec("Pixelforge", 320, 110, { size: 56, bold: true, color: { r: 255, g: 255, b: 255, a: 255 }, align: "center" }),
    effects: {
      dropShadow: defaultDropShadow({ distance: 6, size: 6, opacity: 0.7 }),
      stroke: defaultStroke({ size: 2, color: { r: 20, g: 20, b: 40, a: 255 }, position: "outside" }),
    },
  });
  addLayer(doc, text);

  doc.selection = Selection.fromEllipse(doc.width, doc.height, Rect.make(140, 120, 220, 200));
  doc.activeLayerId = scr.id;
  return doc;
}

export interface DemoHandle {
  readonly doc: Document;
  readonly viewport: Viewport;
  readonly compositor: ICompositor;
  readonly history: History;
  /** Last frame's stats. */
  readonly stats: () => RenderStats;
  /** Paint a soft dot into the active layer (exercise markDirty + PaintCommand). */
  paintDot(docX: number, docY: number, radius?: number): void;
  /** Cycle the active layer's blend mode. */
  cycleBlendMode(): BlendMode;
  /** Force a redraw on the next frame. */
  invalidate(): void;
  dispose(): void;
}

export interface MountDemoOptions {
  forceCanvas2d?: boolean;
  doc?: Document;
}

/** Mount the demo on a canvas. The canvas should fill its container via CSS. */
export function mountDemo(canvas: HTMLCanvasElement, opts: MountDemoOptions = {}): DemoHandle {
  const doc = opts.doc ?? buildDemoDocument();
  const compositor = createCompositor(canvas, opts.forceCanvas2d ? { forceCanvas2d: true } : {});
  const viewport = new Viewport();
  const history = new History(doc, {
    onApply: (cmd) => {
      for (const d of cmd.affected?.() ?? []) compositor.markDirty(d.layerId, d.rect);
    },
  });
  let stats: RenderStats = { drawn: false, recomposited: false, compositedArea: 0, passes: 0, uploads: 0 };
  let raf = 0;
  let phase = 0;
  let fitted = false;
  let disposed = false;

  const cssSize = (): { w: number; h: number } => {
    const r = canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };

  const frame = (t: number): void => {
    if (disposed) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = cssSize();
    if (!fitted) {
      viewport.fitToView(w, h, doc.width, doc.height, 40);
      fitted = true;
    }
    phase = (t / 60) % 8;
    stats = compositor.render(doc, viewport, {
      width: Math.round(w * dpr),
      height: Math.round(h * dpr),
      dpr,
      antsPhase: phase,
      activeLayerId: doc.activeLayerId,
    });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // Wheel = zoom at cursor; drag = pan.
  const pt = { x: 0, y: 0 };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    pt.x = e.clientX - r.left;
    pt.y = e.clientY - r.top;
    viewport.zoomAt(pt, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent): void => {
    if (e.button === 1 || e.button === 0) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    viewport.panBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  const modes = Object.values(BlendMode);

  return {
    doc,
    viewport,
    compositor,
    history,
    stats: () => stats,
    paintDot(docX, docY, radius = 24) {
      if (!doc.activeLayerId) return;
      const layer = getPixelLayer(doc, doc.activeLayerId);
      const lx = Math.round(docX - layer.offset.x);
      const ly = Math.round(docY - layer.offset.y);
      const rect = Rect.intersect(Rect.make(lx - radius - 2, ly - radius - 2, radius * 2 + 4, radius * 2 + 4), layer.raster.bounds());
      if (Rect.isEmpty(rect)) return;
      const captured = PaintCommand.capture(layer, rect);
      disc(layer.raster, lx, ly, radius, [255, 255, 255]);
      history.push(PaintCommand.finish(layer, captured, "Paint dot"), { alreadyApplied: true });
    },
    cycleBlendMode() {
      if (!doc.activeLayerId) return BlendMode.Normal;
      const layer = getPixelLayer(doc, doc.activeLayerId);
      const next = modes[(modes.indexOf(layer.blendMode) + 1) % modes.length]!;
      layer.blendMode = next;
      return next;
    },
    invalidate() {
      compositor.invalidateAll();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      compositor.dispose();
    },
  };
}
