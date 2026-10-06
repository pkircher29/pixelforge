/**
 * Viewport: pan / zoom / rotation of the document inside the canvas.
 *
 * Mapping (CSS px): `screen = R(rotation) * (doc * zoom) + pan`, where `pan` is the
 * screen position of the document origin. The compositor multiplies by DPR itself, so
 * UI code can feed pointer-event coordinates straight in.
 */

import type { Point } from "./rect";
import type { ViewportState } from "./types";

/** Photoshop-like zoom stops as scale factors (1 = 100 %). */
export const ZOOM_STEPS: readonly number[] = [
  0.01, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12,
  16, 24, 32,
];

export const MIN_ZOOM = ZOOM_STEPS[0]!;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** Next zoom stop above `zoom` (or the max). */
export function nextZoomStep(zoom: number): number {
  for (const z of ZOOM_STEPS) if (z > zoom * 1.0001) return z;
  return MAX_ZOOM;
}

/** Next zoom stop below `zoom` (or the min). */
export function prevZoomStep(zoom: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const z = ZOOM_STEPS[i]!;
    if (z < zoom * 0.9999) return z;
  }
  return MIN_ZOOM;
}

/** Clamp to the supported zoom range. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** `"66.67%"`-style label. */
export function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  const s = pct >= 100 ? String(Math.round(pct)) : pct.toFixed(pct < 10 ? 2 : 1).replace(/\.?0+$/, "");
  return `${s}%`;
}

export class Viewport implements ViewportState {
  zoom = 1;
  panX = 0;
  panY = 0;
  rotation = 0;

  constructor(state?: Partial<ViewportState>) {
    if (state) this.set(state);
  }

  set(state: Partial<ViewportState>): this {
    if (state.zoom !== undefined) this.zoom = clampZoom(state.zoom);
    if (state.panX !== undefined) this.panX = state.panX;
    if (state.panY !== undefined) this.panY = state.panY;
    if (state.rotation !== undefined) this.rotation = state.rotation;
    return this;
  }

  clone(): Viewport {
    return new Viewport(this);
  }

  /** Plain snapshot (for stores / persistence). */
  toState(): ViewportState {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY, rotation: this.rotation };
  }

  equals(o: ViewportState): boolean {
    return this.zoom === o.zoom && this.panX === o.panX && this.panY === o.panY && this.rotation === o.rotation;
  }

  /** Document -> screen (CSS px). Writes into `out` when given (no allocation). */
  docToScreen(p: Point, out?: Point): Point {
    const o = out ?? { x: 0, y: 0 };
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const x = p.x * this.zoom;
    const y = p.y * this.zoom;
    o.x = c * x - s * y + this.panX;
    o.y = s * x + c * y + this.panY;
    return o;
  }

  /** Screen (CSS px) -> document (fractional pixels). */
  screenToDoc(p: Point, out?: Point): Point {
    const o = out ?? { x: 0, y: 0 };
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const x = p.x - this.panX;
    const y = p.y - this.panY;
    // Inverse rotation then inverse scale.
    o.x = (c * x + s * y) / this.zoom;
    o.y = (-s * x + c * y) / this.zoom;
    return o;
  }

  /** Zoom by `factor` keeping the document point under `screenPt` fixed. */
  zoomAt(screenPt: Point, factor: number): this {
    return this.setZoomAt(screenPt, this.zoom * factor);
  }

  /** Set an absolute zoom keeping the document point under `screenPt` fixed. */
  setZoomAt(screenPt: Point, zoom: number): this {
    const docPt = this.screenToDoc(screenPt);
    this.zoom = clampZoom(zoom);
    const after = this.docToScreen(docPt);
    this.panX += screenPt.x - after.x;
    this.panY += screenPt.y - after.y;
    return this;
  }

  /** Step to the next Photoshop zoom stop around `screenPt`. */
  zoomIn(screenPt: Point): this {
    return this.setZoomAt(screenPt, nextZoomStep(this.zoom));
  }

  /** Step to the previous Photoshop zoom stop around `screenPt`. */
  zoomOut(screenPt: Point): this {
    return this.setZoomAt(screenPt, prevZoomStep(this.zoom));
  }

  /** Pan by a screen-space delta. */
  panBy(dx: number, dy: number): this {
    this.panX += dx;
    this.panY += dy;
    return this;
  }

  /** Rotate the view around a screen point (radians, delta). */
  rotateAt(screenPt: Point, deltaRad: number): this {
    const docPt = this.screenToDoc(screenPt);
    this.rotation += deltaRad;
    const after = this.docToScreen(docPt);
    this.panX += screenPt.x - after.x;
    this.panY += screenPt.y - after.y;
    return this;
  }

  /**
   * Fit the whole document inside a `viewW x viewH` area with `padding` px, centred,
   * rotation reset. Scales up as well as down ("Fit on Screen").
   */
  fitToView(viewW: number, viewH: number, docW: number, docH: number, padding = 0): this {
    const availW = Math.max(1, viewW - padding * 2);
    const availH = Math.max(1, viewH - padding * 2);
    const zoom = Math.min(availW / Math.max(1, docW), availH / Math.max(1, docH));
    this.rotation = 0;
    this.zoom = clampZoom(zoom);
    this.panX = (viewW - docW * this.zoom) / 2;
    this.panY = (viewH - docH * this.zoom) / 2;
    return this;
  }

  /** 100 % zoom, document centred, rotation reset. */
  actualPixels(viewW: number, viewH: number, docW: number, docH: number): this {
    this.rotation = 0;
    this.zoom = 1;
    this.panX = Math.round((viewW - docW) / 2);
    this.panY = Math.round((viewH - docH) / 2);
    return this;
  }

  /** Centre the view on a document point. */
  centerOn(docPt: Point, viewW: number, viewH: number): this {
    const s = this.docToScreen(docPt);
    this.panX += viewW / 2 - s.x;
    this.panY += viewH / 2 - s.y;
    return this;
  }

  /**
   * 3x3 column-major doc->screen matrix (for GLSL `mat3`). `scale` multiplies the
   * result (use DPR). Writes into `out` (length >= 9).
   */
  matrix(out: Float32Array, scale = 1): Float32Array {
    const c = Math.cos(this.rotation) * this.zoom * scale;
    const s = Math.sin(this.rotation) * this.zoom * scale;
    // column 0
    out[0] = c;
    out[1] = s;
    out[2] = 0;
    // column 1
    out[3] = -s;
    out[4] = c;
    out[5] = 0;
    // column 2
    out[6] = this.panX * scale;
    out[7] = this.panY * scale;
    out[8] = 1;
    return out;
  }

  /** 3x3 column-major screen->doc matrix. */
  inverseMatrix(out: Float32Array, scale = 1): Float32Array {
    const z = this.zoom * scale;
    const c = Math.cos(this.rotation) / z;
    const s = Math.sin(this.rotation) / z;
    const px = this.panX * scale;
    const py = this.panY * scale;
    // inv = S^-1 * R^-1 * T^-1
    out[0] = c;
    out[1] = -s;
    out[2] = 0;
    out[3] = s;
    out[4] = c;
    out[5] = 0;
    out[6] = -(c * px + s * py);
    out[7] = -(-s * px + c * py);
    out[8] = 1;
    return out;
  }
}
