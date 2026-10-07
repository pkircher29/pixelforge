/**
 * Horizontal / Vertical Type (T) and the Type Mask variants. Click to start a new text
 * layer (or click into an existing one to re-edit); the hidden editor in
 * `tools/ui/TypeEditor.svelte` captures typing; this tool draws the caret / selection /
 * bounds on the overlay. Enter = new line, Ctrl+Enter commits, Esc cancels.
 */
import { Type, TypeOutline } from "@lucide/svelte";
import { textBounds, type TextSpec } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { linePosOf, lines, selectionSpans } from "./text-session";
import { specFromOptions, typeSession, type TypeVariant } from "./type-session.svelte";
import { quoteFamily } from "./fonts";
import { toolStore } from "$lib/stores/tool.svelte";

const STYLE_OPTION: ToolOption = {
  kind: "select",
  key: "style",
  label: "",
  choices: [
    { value: "regular", label: "Regular" },
    { value: "bold", label: "Bold" },
    { value: "italic", label: "Italic" },
    { value: "boldItalic", label: "Bold Italic" },
  ],
  default: "regular",
};
const AA_OPTION: ToolOption = {
  kind: "select",
  key: "antialias",
  label: "aa",
  choices: [
    { value: "none", label: "None" },
    { value: "sharp", label: "Sharp" },
    { value: "crisp", label: "Crisp" },
    { value: "strong", label: "Strong" },
    { value: "smooth", label: "Smooth" },
  ],
  default: "smooth",
};

export function cssFontFor(spec: TextSpec, scale = 1): string {
  return `${spec.italic ? "italic " : ""}${spec.bold ? "bold " : ""}${Math.max(1, spec.size * scale)}px ${quoteFamily(spec.font)}`;
}

export class TypeTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut = "t";
  readonly group = "type";
  readonly groupOrder: number;
  readonly glyph: string;
  readonly cursor = "text";
  readonly hint: string;
  readonly options: readonly ToolOption[];
  readonly variant: TypeVariant;

  constructor(variant: TypeVariant) {
    this.variant = variant;
    this.id = variant === "h" ? "text" : variant === "v" ? "type-v" : variant === "mask-h" ? "type-mask-h" : "type-mask-v";
    this.name = variant === "h" ? "Horizontal Type" : variant === "v" ? "Vertical Type" : variant === "mask-h" ? "Horizontal Type Mask" : "Vertical Type Mask";
    this.icon = variant.startsWith("mask") ? TypeOutline : Type;
    this.groupOrder = ["h", "v", "mask-h", "mask-v"].indexOf(variant);
    this.glyph = variant === "h" ? "type-h" : this.id;
    this.hint = variant.startsWith("mask")
      ? "Click and type; Ctrl+Enter turns the text into a selection, Esc cancels."
      : "Click to add text (or click existing text to edit). Enter = new line, Ctrl+Enter commits, Esc cancels.";
    this.options = [
      { kind: "custom", key: "family", renderer: "font-picker", label: "", default: "Segoe UI" },
      STYLE_OPTION,
      { kind: "number", key: "size", label: "", min: 1, max: 1296, step: 1, default: 48, unit: "pt", log: true },
      AA_OPTION,
      { kind: "custom", key: "align", renderer: "icon-select", label: "", default: "left", props: { items: [{ value: "left", icon: "align-left", title: "Left align text" }, { value: "center", icon: "align-hcenter", title: "Center text" }, { value: "right", icon: "align-right", title: "Right align text" }] } },
      { kind: "color", key: "fg", label: "" },
      { kind: "button", key: "commit", label: "Commit", primary: true, action: () => typeSession.commit() },
      { kind: "button", key: "cancel", label: "Cancel", action: () => typeSession.cancel() },
    ];
  }

  private hitTextLayer(ctx: ToolContext, x: number, y: number): string | null {
    const doc = ctx.doc;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i]!;
      if (l.kind !== "text" || !l.visible) continue;
      const px = Math.floor(x - l.offset.x);
      const py = Math.floor(y - l.offset.y);
      if (l.raster.getPixel(px, py).a > 8) return l.id;
      const b = textBounds(l.text);
      if (x >= b.x + l.offset.x - 4 && x <= b.x + b.w + l.offset.x + 4 && y >= b.y + l.offset.y - 4 && y <= b.y + b.h + l.offset.y + 4) return l.id;
    }
    return null;
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (typeSession.active) {
      // Click inside the current text: move the caret there; outside: commit and start anew.
      const idx = this.indexAtPoint(ctx, e.x, e.y);
      if (idx !== null) {
        typeSession.setModel({ text: typeSession.model.text, caret: idx, anchor: e.shiftKey ? typeSession.model.anchor : idx });
        return;
      }
      typeSession.commit();
    }
    if (!this.variant.startsWith("mask")) {
      const hit = this.hitTextLayer(ctx, e.x, e.y);
      if (hit) {
        typeSession.beginEdit(hit);
        this.syncOptionsFromSpec();
        // PS: the caret lands where you clicked.
        const idx = this.indexAtPoint(ctx, e.x, e.y);
        if (idx !== null) typeSession.setModel({ text: typeSession.model.text, caret: idx, anchor: idx });
        return;
      }
    }
    const spec = specFromOptions(this.id, this.variant === "v" || this.variant === "mask-v");
    typeSession.beginNew(Math.round(e.x), Math.round(e.y), spec, this.variant);
  }

  /** Push the edited layer's font/size/style into the options bar (re-edit). */
  private syncOptionsFromSpec(): void {
    const s = typeSession.spec;
    toolStore.setOption(this.id, "family", s.font);
    toolStore.setOption(this.id, "size", s.size);
    toolStore.setOption(this.id, "style", s.bold && s.italic ? "boldItalic" : s.bold ? "bold" : s.italic ? "italic" : "regular");
    toolStore.setOption(this.id, "align", s.align);
    toolStore.setOption(this.id, "antialias", s.antialias ? "smooth" : "none");
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (typeSession.active) ctx.setCursor(this.indexAtPoint(ctx, e.x, e.y) !== null ? "text" : "text");
    else ctx.setCursor(this.variant.startsWith("mask") ? "text" : this.hitTextLayer(ctx, e.x, e.y) ? "text" : "text");
  }

  onPointerUp(): void {}

  onKey(e: KeyboardEvent, _ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down" || !typeSession.active) return false;
    if (e.key === "Escape") {
      typeSession.cancel();
      return true;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      typeSession.commit();
      return true;
    }
    return false;
  }

  cancel(_ctx: ToolContext): void {
    if (typeSession.active) typeSession.commit();
  }

  onDeactivate(): void {
    if (typeSession.active) typeSession.commit();
  }

  // ------------------------------------------------------------------ layout helpers

  /** Measure helper on the overlay context (same glyph-by-glyph metric as the engine). */
  private measure(g: CanvasRenderingContext2D, spec: TextSpec, s: string): number {
    const track = (spec.tracking / 1000) * spec.size;
    let w = 0;
    for (const ch of Array.from(s)) w += g.measureText(ch).width + track;
    return w;
  }

  private lineStartX(g: CanvasRenderingContext2D, spec: TextSpec, line: string): number {
    const w = this.measure(g, spec, line);
    return spec.align === "left" ? spec.x : spec.align === "center" ? spec.x - w / 2 : spec.x - w;
  }

  private lineHeight(spec: TextSpec): number {
    return spec.leading ?? Math.round(spec.size * 1.2);
  }

  /** Text index under a document point, or null when outside the text. */
  private indexAtPoint(_ctx: ToolContext, x: number, y: number): number | null {
    const spec = typeSession.spec;
    const text = typeSession.model.text;
    const ls = lines(text);
    const lh = this.lineHeight(spec);
    const g = measureCtx();
    if (!g) return null;
    g.font = cssFontFor(spec);
    if (spec.vertical) {
      const col = Math.floor((y - (spec.y - spec.size)) / lh);
      if (Math.abs(x - spec.x) > spec.size || col < 0 || col >= Math.max(1, text.length)) return null;
      return Math.max(0, Math.min(text.length, col));
    }
    const line = Math.floor((y - (spec.y - spec.size)) / lh);
    if (line < 0 || line >= ls.length) return null;
    const l = ls[line]!;
    const x0 = this.lineStartX(g, spec, l);
    const w = this.measure(g, spec, l);
    if (x < x0 - 6 || x > x0 + w + 6) return null;
    let acc = x0;
    let col = 0;
    const track = (spec.tracking / 1000) * spec.size;
    for (const ch of Array.from(l)) {
      const cw = g.measureText(ch).width + track;
      if (x < acc + cw / 2) break;
      acc += cw;
      col += ch.length;
    }
    let idx = 0;
    for (let i = 0; i < line; i++) idx += ls[i]!.length + 1;
    return idx + col;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!typeSession.active) return;
    void typeSession.version;
    const spec = typeSession.spec;
    const model = typeSession.model;
    const vp = ctx.viewport;
    const zoom = vp.zoom;
    const ls = lines(model.text);
    const lh = this.lineHeight(spec);
    g.save();
    g.font = cssFontFor(spec);
    // Mask variants: draw the text itself as a translucent preview (no layer exists).
    if (typeSession.isMask) {
      g.save();
      const o = vp.docToScreen({ x: 0, y: 0 });
      g.translate(o.x, o.y);
      g.rotate(vp.rotation);
      g.scale(zoom, zoom);
      g.font = cssFontFor(spec);
      g.fillStyle = "rgba(255,0,0,0.45)";
      g.textBaseline = "alphabetic";
      ls.forEach((line, li) => {
        const y = spec.y + li * lh;
        if (spec.vertical) {
          Array.from(line).forEach((ch, ci) => g.fillText(ch, spec.x - g.measureText(ch).width / 2, spec.y + ci * lh));
          return;
        }
        let x = this.lineStartX(g, spec, line);
        for (const ch of Array.from(line)) {
          g.fillText(ch, x, y);
          x += g.measureText(ch).width + (spec.tracking / 1000) * spec.size;
        }
      });
      g.restore();
    }
    // Selection highlight.
    const spans = selectionSpans(model);
    g.fillStyle = "rgba(20,115,230,0.35)";
    for (const sp of spans) {
      const line = ls[sp.line] ?? "";
      if (spec.vertical) {
        const a = vp.docToScreen({ x: spec.x - spec.size / 2, y: spec.y - spec.size + sp.start * lh });
        const b = vp.docToScreen({ x: spec.x + spec.size / 2, y: spec.y - spec.size + sp.end * lh });
        g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        continue;
      }
      const x0 = this.lineStartX(g, spec, line);
      const xs = x0 + this.measure(g, spec, line.slice(0, sp.start));
      const xe = x0 + this.measure(g, spec, line.slice(0, sp.end));
      const top = spec.y + sp.line * lh - spec.size;
      const a = vp.docToScreen({ x: xs, y: top });
      const b = vp.docToScreen({ x: xe, y: top + lh });
      g.fillRect(a.x, a.y, Math.max(1, b.x - a.x), b.y - a.y);
    }
    // Caret (blinks with wall-clock time; the editor invalidates the overlay periodically).
    const pos = linePosOf(model.text, model.caret);
    const blinkOn = Math.floor(performance.now() / 530) % 2 === 0;
    if (blinkOn) {
      let a: { x: number; y: number };
      let b: { x: number; y: number };
      if (spec.vertical) {
        const yy = spec.y - spec.size + model.caret * lh;
        a = vp.docToScreen({ x: spec.x - spec.size / 2, y: yy });
        b = vp.docToScreen({ x: spec.x + spec.size / 2, y: yy });
      } else {
        const line = ls[pos.line] ?? "";
        const cx = this.lineStartX(g, spec, line) + this.measure(g, spec, line.slice(0, pos.col));
        const top = spec.y + pos.line * lh - spec.size;
        a = vp.docToScreen({ x: cx, y: top });
        b = vp.docToScreen({ x: cx, y: top + lh });
      }
      g.strokeStyle = "#000";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.stroke();
    }
    // Bounding box (PS shows a thin frame while editing).
    const tb = textBounds(spec, g);
    const p0 = vp.docToScreen({ x: tb.x - 2, y: tb.y - 2 });
    const p1 = vp.docToScreen({ x: tb.x + tb.w + 2, y: tb.y + tb.h + 2 });
    g.strokeStyle = "rgba(20,115,230,0.8)";
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.strokeRect(Math.round(p0.x) + 0.5, Math.round(p0.y) + 0.5, Math.round(p1.x - p0.x), Math.round(p1.y - p0.y));
    g.restore();
  }
}

let mctx: CanvasRenderingContext2D | null | undefined;
function measureCtx(): CanvasRenderingContext2D | null {
  if (mctx !== undefined) return mctx;
  try {
    const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
    mctx = c ? c.getContext("2d") : null;
  } catch {
    mctx = null;
  }
  return mctx;
}

/** Start editing a text layer from outside the tool (Layers panel double-click). Switches to the Type tool. */
export function editTextLayer(ctx: ToolContext, layerId: string): boolean {
  ctx.selectTool("text");
  return typeSession.beginEdit(layerId);
}
