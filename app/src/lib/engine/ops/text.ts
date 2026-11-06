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
    allCaps: false,
    smallCaps: false,
    underline: false,
    strikethrough: false,
    paragraphWidth: null,
    indentLeft: 0,
    indentRight: 0,
    firstLineIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    justification: "none",
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

/** One source character may display multiple capitals (for example ß → SS). */
export function textGlyphs(spec: TextSpec, line: string): { text: string; size: number }[] {
  return Array.from(line, ch => {
    const upper = ch.toUpperCase();
    const small = !spec.allCaps && spec.smallCaps && ch !== upper;
    return { text: spec.allCaps || small ? upper : ch, size: small ? spec.size * 0.7 : spec.size };
  });
}

function glyphWidth(spec: TextSpec, glyph: { text: string; size: number }, ctx?: Ctx2D | null): number {
  if (!ctx) return Array.from(glyph.text).length * glyph.size * 0.6;
  ctx.font = cssFont({ ...spec, size: glyph.size });
  return ctx.measureText(glyph.text).width;
}

/** Measure a line's advance width (canvas when available, else the fallback metric). */
export function measureLine(spec: TextSpec, line: string, ctx?: Ctx2D | null): number {
  const track = (spec.tracking / 1000) * spec.size;
  return textGlyphs(spec, line).reduce((width, glyph) => width + glyphWidth(spec, glyph, ctx) + track, 0);
}

export interface TextLayoutGlyph {
  text: string;
  size: number;
  /** UTF-16 offsets into the unchanged source text. */
  start: number;
  end: number;
  x: number;
  advance: number;
  inkWidth: number;
}
export interface TextLayoutLine {
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  paragraphEnd: boolean;
  glyphs: TextLayoutGlyph[];
}

export function lineCaretX(line: TextLayoutLine, index: number): number {
  for (const glyph of line.glyphs) {
    if (index <= glyph.start) return glyph.x;
    if (index < glyph.end) return glyph.x;
  }
  return line.x + line.width;
}

export function moveLayoutCaret(spec: TextSpec, index: number, key: "ArrowUp" | "ArrowDown" | "Home" | "End", ctx?: Ctx2D | null): number {
  const lines = layoutText(spec, ctx);
  const current = lines.reduce((last, line, i) => line.start <= index ? i : last, 0);
  const line = lines[current]!;
  if (key === "Home") return line.start;
  if (key === "End") return line.paragraphEnd ? line.end : line.glyphs.filter(g => g.advance !== 0).at(-1)?.end ?? line.end;
  const target = lines[current + (key === "ArrowDown" ? 1 : -1)];
  if (!target) return key === "ArrowUp" ? 0 : spec.text.length;
  const x = lineCaretX(line, index);
  for (const glyph of target.glyphs) if (x < glyph.x + glyph.advance / 2) return glyph.start;
  return target.paragraphEnd ? target.end : target.glyphs.filter(g => g.advance !== 0).at(-1)?.end ?? target.end;
}

/** Source-indexed layout shared by painting, selection and hit testing. */
export function layoutText(spec: TextSpec, ctx?: Ctx2D | null): TextLayoutLine[] {
  const result: TextLayoutLine[] = [];
  const track = (spec.tracking / 1000) * spec.size;
  const lh = lineHeightOf(spec);
  const boxWidth = !spec.vertical && (spec.paragraphWidth ?? 0) > 0 ? spec.paragraphWidth! : null;
  const left = spec.indentLeft ?? 0, right = spec.indentRight ?? 0;
  let baseline = spec.y + (spec.spaceBefore ?? 0);
  const paragraphs = spec.vertical
    ? spec.text.match(/\r\n|[\s\S]/gu) ?? [""]
    : spec.text.split(/\r\n|\r|\n/);
  let sourceOffset = 0;
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const rawParagraph = paragraphs[pi]!;
    const paragraph = spec.vertical && /[\r\n]/.test(rawParagraph) ? "" : rawParagraph;
    let offset = sourceOffset;
    const sourceGlyphs = Array.from(paragraph, ch => {
      const glyph = textGlyphs(spec, ch)[0]!;
      const inkWidth = glyphWidth(spec, glyph, ctx);
      const entry = { ...glyph, start: offset, end: offset + ch.length, x: 0, advance: inkWidth + track, inkWidth, whitespace: /\s/.test(ch) };
      offset += ch.length;
      return entry;
    });
    let cursor = 0, first = true;
    do {
      const indent = left + (first ? spec.firstLineIndent ?? 0 : 0);
      const available = boxWidth === null ? Infinity : Math.max(1, boxWidth - indent - right);
      let end = sourceGlyphs.length;
      if (boxWidth !== null) {
        let width = 0, lastBreak = -1;
        for (let i = cursor; i < sourceGlyphs.length; i++) {
          const glyph = sourceGlyphs[i]!;
          if (width + glyph.advance > available && i > cursor) {
            end = lastBreak > cursor ? lastBreak : i;
            // Consume a boundary space with the preceding line, without drawing it.
            while (end < sourceGlyphs.length && sourceGlyphs[end]!.whitespace) end++;
            break;
          }
          width += glyph.advance;
          if (glyph.whitespace) lastBreak = i + 1;
        }
      }
      const last = end === sourceGlyphs.length;
      const glyphs = sourceGlyphs.slice(cursor, end).map(g => ({ ...g }));
      let visible = glyphs.length;
      if (!last) while (visible && glyphs[visible - 1]!.whitespace) visible--;
      for (let i = visible; i < glyphs.length; i++) { glyphs[i]!.advance = 0; glyphs[i]!.inkWidth = 0; }
      const naturalWidth = glyphs.reduce((sum, g) => sum + g.advance, 0);
      const mode = spec.justification ?? "none";
      const justified = boxWidth !== null && mode !== "none" && (!last || mode === "all");
      const gaps = glyphs.map((g, i) => g.whitespace && i > 0 && i < visible - 1 ? i : -1).filter(i => i >= 0);
      // Single words can still be fully justified, by distributing between glyphs.
      if (justified && !gaps.length) for (let i = 0; i < visible - 1; i++) gaps.push(i);
      if (justified && gaps.length && naturalWidth < available) {
        const extra = (available - naturalWidth) / gaps.length;
        for (const i of gaps) glyphs[i]!.advance += extra;
      }
      const width = glyphs.reduce((sum, g) => sum + g.advance, 0);
      const align = boxWidth !== null && mode !== "none" ? mode === "all" ? "left" : mode : spec.align;
      const origin = spec.x + indent;
      const x = spec.vertical ? spec.x - width / 2
        : boxWidth !== null ? origin + (align === "center" ? (available - width) / 2 : align === "right" ? available - width : 0)
        : origin - (align === "center" ? width / 2 : align === "right" ? width + right : 0);
      let gx = x;
      for (const glyph of glyphs) { glyph.x = gx; gx += glyph.advance; }
      result.push({ start: glyphs[0]?.start ?? sourceOffset, end: glyphs.at(-1)?.end ?? sourceOffset, x, y: baseline, width, paragraphEnd: last, glyphs });
      baseline += lh;
      cursor = end;
      first = false;
    } while (cursor < sourceGlyphs.length);
    if (!spec.vertical) baseline += (spec.spaceAfter ?? 0) + (spec.spaceBefore ?? 0);
    sourceOffset += rawParagraph.length;
    if (!spec.vertical) {
      if (spec.text.slice(sourceOffset, sourceOffset + 2) === "\r\n") sourceOffset += 2;
      else if (sourceOffset < spec.text.length) sourceOffset++;
    }
  }
  return result;
}

/** Shared by committed type and the live type-mask preview. */
export function drawText(ctx: Ctx2D, spec: TextSpec): void {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const thickness = Math.max(1, spec.size / 16);
  layoutText(spec, ctx).forEach(line => {
    for (const glyph of line.glyphs) {
      ctx.font = cssFont({ ...spec, size: glyph.size });
      if (glyph.inkWidth) ctx.fillText(glyph.text, glyph.x, line.y);
    }
    if (spec.underline) ctx.fillRect(line.x, line.y + spec.size * 0.12, line.width, thickness);
    if (spec.strikethrough) ctx.fillRect(line.x, line.y - spec.size * 0.3, line.width, thickness);
  });
  ctx.font = cssFont(spec);
}

/** Approximate bounding box of the rendered text (document space), for selection / transform handles. */
export function textBounds(spec: TextSpec, ctx?: Ctx2D | null): { x: number; y: number; w: number; h: number } {
  const lines = layoutText(spec, ctx);
  const lh = lineHeightOf(spec);
  const x = Math.min(...lines.map(l => l.x));
  const right = Math.max(...lines.map(l => l.x + l.width));
  const y = lines[0]!.y - spec.size;
  return { x, y, w: Math.max(1, right - x), h: lines.at(-1)!.y - lines[0]!.y + lh };
}

/**
 * Rasterize `spec` into a new `w x h` raster (straight alpha). Glyphs are drawn one by
 * one so tracking applies uniformly; vertical type stacks glyphs centred on `x`.
 */
export function rasterizeText(spec: TextSpec, w: number, h: number): Raster {
  const out = new Raster(w, h);
  if (w === 0 || h === 0 || spec.text.length === 0) return out;
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
    drawText(ctx, spec);
    const data = c2d.readback();
    out.data.set(data);
    if (!spec.antialias) {
      const d = out.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i]! >= 128 ? 255 : 0;
    }
    return out;
  }
  // Fallback block renderer (no 2D canvas).
  const color: RGBA = { ...spec.color };
  const box = (x0: number, y0: number, bw: number, bh: number): void => {
    const xa = Math.max(0, Math.round(x0));
    const ya = Math.max(0, Math.round(y0));
    const xb = Math.min(w, Math.round(x0 + bw));
    const yb = Math.min(h, Math.round(y0 + bh));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) out.setPixel(x, y, color);
  };
  layoutText(spec).forEach(line => {
    for (const glyph of line.glyphs) {
      if (glyph.text.trim()) box(glyph.x, line.y - glyph.size * 0.7, glyph.inkWidth, glyph.size * 0.7);
    }
    if (spec.underline) box(line.x, line.y + spec.size * 0.12, line.width, Math.max(1, spec.size / 16));
    if (spec.strikethrough) box(line.x, line.y - spec.size * 0.3, line.width, Math.max(1, spec.size / 16));
  });
  return out;
}
