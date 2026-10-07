/**
 * Navigator panel geometry (pure): fit the document thumbnail into the panel, map the
 * viewport's visible document rect to the red view box, and turn box drags / clicks
 * back into viewport pans. Tested in `tests/panels/navigator.test.ts`.
 */
import type { ViewportState } from "$lib/engine";

export interface ThumbLayout {
  /** Thumb rect inside the panel area (CSS px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Thumb px per document px. */
  scale: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fit `docW × docH` into `areaW × areaH` (never larger than `maxPx` on either side), centred. */
export function thumbLayout(docW: number, docH: number, areaW: number, areaH: number, maxPx = 256): ThumbLayout {
  const availW = Math.max(1, Math.min(areaW, maxPx));
  const availH = Math.max(1, Math.min(areaH, maxPx));
  const scale = Math.min(availW / Math.max(1, docW), availH / Math.max(1, docH));
  const w = Math.max(1, Math.round(docW * scale));
  const h = Math.max(1, Math.round(docH * scale));
  return { x: Math.round((areaW - w) / 2), y: Math.round((areaH - h) / 2), w, h, scale: w / Math.max(1, docW) };
}

/** Document rect currently visible in a `viewW × viewH` canvas (rotation ignored). */
export function visibleDocRect(vp: Pick<ViewportState, "zoom" | "panX" | "panY">, viewW: number, viewH: number): Box {
  return { x: -vp.panX / vp.zoom, y: -vp.panY / vp.zoom, w: viewW / vp.zoom, h: viewH / vp.zoom };
}

/** The red view box in panel coordinates (unclipped; the renderer clips to the thumb). */
export function viewBox(vp: Pick<ViewportState, "zoom" | "panX" | "panY">, viewW: number, viewH: number, layout: ThumbLayout): Box {
  const r = visibleDocRect(vp, viewW, viewH);
  return { x: layout.x + r.x * layout.scale, y: layout.y + r.y * layout.scale, w: r.w * layout.scale, h: r.h * layout.scale };
}

/** Clip a box to the thumb rect (what is drawn). */
export function clipBox(b: Box, layout: ThumbLayout): Box {
  const x0 = Math.max(b.x, layout.x);
  const y0 = Math.max(b.y, layout.y);
  const x1 = Math.min(b.x + b.w, layout.x + layout.w);
  const y1 = Math.min(b.y + b.h, layout.y + layout.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** True when the whole document is inside the view (PS hides the box then — we draw it faintly). */
export function showsWholeDoc(vp: Pick<ViewportState, "zoom" | "panX" | "panY">, viewW: number, viewH: number, docW: number, docH: number): boolean {
  const r = visibleDocRect(vp, viewW, viewH);
  return r.x <= 0 && r.y <= 0 && r.x + r.w >= docW && r.y + r.h >= docH;
}

/** Pan so that the document point under panel point `(px, py)` sits at the view centre. */
export function panToPoint(vp: Pick<ViewportState, "zoom" | "panX" | "panY">, px: number, py: number, layout: ThumbLayout, viewW: number, viewH: number): { panX: number; panY: number } {
  const docX = (px - layout.x) / layout.scale;
  const docY = (py - layout.y) / layout.scale;
  return { panX: viewW / 2 - docX * vp.zoom, panY: viewH / 2 - docY * vp.zoom };
}

/** Pan for a box drag of `(dx, dy)` panel px (the box moves with the pointer, the view follows). */
export function panByDrag(vp: Pick<ViewportState, "zoom" | "panX" | "panY">, dx: number, dy: number, layout: ThumbLayout): { panX: number; panY: number } {
  const k = vp.zoom / layout.scale;
  return { panX: vp.panX - dx * k, panY: vp.panY - dy * k };
}

/** Slider position 0..1 ↔ zoom, log-scaled between `min` and `max`. */
export function zoomToSlider(zoom: number, min: number, max: number): number {
  const t = (Math.log(zoom) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.max(0, Math.min(1, t));
}

export function sliderToZoom(t: number, min: number, max: number): number {
  const x = Math.max(0, Math.min(1, t));
  return Math.exp(Math.log(min) + x * (Math.log(max) - Math.log(min)));
}

/** Parse "66.7", "66.7%", " 200 " into a zoom factor, or null. */
export function parseZoomPercent(text: string): number | null {
  const v = parseFloat(text.replace("%", "").trim());
  return Number.isFinite(v) && v > 0 ? v / 100 : null;
}
