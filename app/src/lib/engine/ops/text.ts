/**
 * Type-layer rasterization. Uses a 2D canvas (`OffscreenCanvas` when available, else a
 * DOM canvas) to draw `TextSpec` into a document-sized raster. In environments without
 * a 2D context (vitest / jsdom) a deterministic block renderer stands in: every glyph
 * becomes a filled box of `0.6 em x 0.7 em` on the baseline, so layout (position,
 * alignment, leading, tracking, vertical flag) stays testable.
 */

import { Raster } from "../raster";
import type { RGBA, TextSpec } from "../types";

/** Build a `TextSpec` with PS-like defaults. */
export function textSpec(text: string, x: number, y: number, over: Partial<TextSpec> = {}): TextSpec {
  return {
    text,
    x,
    y,
    font: "Segoe UI, Helvetica, Arial, sans-serif",
    size: 48,
    color: { r: 0, g: 0, b: 0, a: 255 },
    align: "left",
    leading: null,
    tracking: 0,
    bold: false,
    italic: false,
    vertical: false,
    antialias: true,
    ...over,
  };
}

/** Line height in px (auto = 1.2 em). */
export function lineHeightOf(spec: TextSpec): number {
  return spec.leading ?? Math.round(spec.size * 1.2);
}

/** CSS font shorthand for `ctx.font`. */
export function cssFont(spec: TextSpec): string {
  return `${spec.italic ? "italic " : ""}${spec.bold ? "bold " : ""}${spec.size}px ${spec.font}`;
}

/** Lines of the text (vertical type: one glyph per line). */
export function textLines(spec: TextSpec): string[] {
  if (spec.vertical) return Array.from(spec.text.replace(/\r\n?/g, "\n")).map((ch) => (ch === "\n" ? "" : ch));
  return spec.text.replace(/\r\n?/g, "\n").split("\n");
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function make2d(w: number, h: number): { ctx: Ctx2D; readback: () => Uint8ClampedArray } | null {
  try {
    if (typeof OffscreenCanvas === "function") {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (ctx) return { ctx, readback: () => ctx.getImageData(0, 0, w, h).data };
    }
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return null;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (ctx) return { ctx, readback: () => ctx.getImageData(0, 0, w, h).data };
    }
  } catch {
    /* fall through to the block renderer */
  }
  return null;
}

/** Approximate glyph advance used by the fallback renderer and for measuring without a canvas. */
export function fallbackAdvance(spec: TextSpec): number {
  return spec.size * 0.6 + (spec.tracking / 1000) * spec.size;
}

/** Measure a line's advance width (canvas when available, else the fallback metric). */
export function measureLine(spec: TextSpec, line: string, ctx?: Ctx2D | null): number {
  const track = (spec.tracking / 1000) * spec.size;
  if (ctx) {
    ctx.font = cssFont(spec);
    let wsum = 0;
    for (const ch of Array.from(line)) wsum += ctx.measureText(ch).width + track;
    return wsum;
  }
  return Array.from(line).length * fallbackAdvance(spec);
}

/** Approximate bounding box of the rendered text (document space), for selection / transform handles. */
export function textBounds(spec: TextSpec, ctx?: Ctx2D | null): { x: number; y: number; w: number; h: number } {
  const lines = textLines(spec);
  const lh = lineHeightOf(spec);
  if (spec.vertical) {
    const w = spec.size;
    return { x: spec.x - w / 2, y: spec.y - spec.size, w, h: Math.max(1, lines.length) * lh };
  }
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, measureLine(spec, l, ctx));
  const x = spec.align === "left" ? spec.x : spec.align === "center" ? spec.x - maxW / 2 : spec.x - maxW;
  return { x, y: spec.y - spec.size, w: Math.max(1, maxW), h: Math.max(1, lines.length) * lh };
}

/**
 * Rasterize `spec` into a new `w x h` raster (straight alpha). Glyphs are drawn one by
 * one so tracking applies uniformly; vertical type stacks glyphs centred on `x`.
 */
export function rasterizeText(spec: TextSpec, w: number, h: number): Raster {
  const out = new Raster(w, h);
  if (w === 0 || h === 0 || spec.text.length === 0) return out;
  const lines = textLines(spec);
  const lh = lineHeightOf(spec);
  const track = (spec.tracking / 1000) * spec.size;
  const c2d = make2d(w, h);
  if (c2d) {
    const { ctx } = c2d;
    ctx.clearRect(0, 0, w, h);
    ctx.font = cssFont(spec);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${spec.color.r}, ${spec.color.g}, ${spec.color.b}, ${spec.color.a / 255})`;
    const smoothing = spec.antialias;
    if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = smoothing;
    lines.forEach((line, li) => {
      const y = spec.y + li * lh;
      if (spec.vertical) {
        if (!line) return;
        const gw = ctx.measureText(line).width;
        ctx.fillText(line, spec.x - gw / 2, y);
        return;
      }
      const width = measureLine(spec, line, ctx);
      let x = spec.align === "left" ? spec.x : spec.align === "center" ? spec.x - width / 2 : spec.x - width;
      for (const ch of Array.from(line)) {
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width + track;
      }
    });
    const data = c2d.readback();
    out.data.set(data);
    if (!spec.antialias) {
      const d = out.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i]! >= 128 ? 255 : 0;
    }
    return out;
  }
  // Fallback block renderer (no 2D canvas).
  const adv = fallbackAdvance(spec);
  const gw = spec.size * 0.6;
  const gh = spec.size * 0.7;
  const color: RGBA = { ...spec.color };
  const box = (x0: number, y0: number, bw: number, bh: number): void => {
    const xa = Math.max(0, Math.round(x0));
    const ya = Math.max(0, Math.round(y0));
    const xb = Math.min(w, Math.round(x0 + bw));
    const yb = Math.min(h, Math.round(y0 + bh));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) out.setPixel(x, y, color);
  };
  lines.forEach((line, li) => {
    const y = spec.y + li * lh;
    if (spec.vertical) {
      if (line && line !== " ") box(spec.x - gw / 2, y - gh, gw, gh);
      return;
    }
    const width = Array.from(line).length * adv;
    let x = spec.align === "left" ? spec.x : spec.align === "center" ? spec.x - width / 2 : spec.x - width;
    for (const ch of Array.from(line)) {
      if (ch !== " ") box(x, y - gh, gw, gh);
      x += adv;
    }
  });
  return out;
}
