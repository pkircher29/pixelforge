/** Text (T): click to place a single line; Enter rasterises it into the active layer. */
import { Type } from "@lucide/svelte";
import { PaintCommand, Rect } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { rasterizeText, TEXT_FAMILIES } from "./paint/text";
import { paintableLayer } from "./util";

export class TextTool implements Tool {
  readonly id = "text";
  readonly name = "Text";
  readonly icon = Type;
  readonly shortcut = "t";
  readonly cursor = "text";
  readonly hint = "Click where the text should start, type, then press Enter. Esc discards.";
  readonly options: readonly ToolOption[] = [
    { kind: "select", key: "family", label: "Font", choices: TEXT_FAMILIES.map((f) => ({ value: f, label: f })), default: "Segoe UI" },
    { kind: "number", key: "size", label: "Size", min: 4, max: 800, step: 1, default: 48, unit: "px", log: true },
    { kind: "toggle", key: "bold", label: "Bold", default: false },
    { kind: "toggle", key: "italic", label: "Italic", default: false },
    { kind: "color", key: "fg", label: "Colour" },
  ];

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (!paintableLayer(ctx, "add text")) return;
    ctx.beginTextEdit(Math.round(e.x), Math.round(e.y));
  }

  onPointerMove(): void {}
  onPointerUp(): void {}

  /** Called by the canvas view when the inline editor commits. */
  commit(ctx: ToolContext, text: string, docX: number, docY: number): void {
    const layer = paintableLayer(ctx, "add text");
    if (!layer) return;
    const out = rasterizeText(text, {
      family: ctx.opt<string>("family"),
      size: ctx.opt<number>("size"),
      bold: ctx.opt<boolean>("bold"),
      italic: ctx.opt<boolean>("italic"),
      color: ctx.fg(),
    });
    if (!out) return;
    const lx = docX - layer.offset.x + out.dx;
    const ly = docY - layer.offset.y + out.dy;
    const target = Rect.intersect(Rect.make(lx, ly, out.raster.width, out.raster.height), layer.raster.bounds());
    if (Rect.isEmpty(target)) {
      ctx.notify("info", "The text landed outside the layer.");
      return;
    }
    const captured = PaintCommand.capture(layer, target);
    // Clip to the selection if there is one.
    const sel = ctx.doc.selection;
    if (!sel.isEmpty) {
      const d = out.raster.data;
      for (let y = 0; y < out.raster.height; y++) {
        for (let x = 0; x < out.raster.width; x++) {
          const m = sel.get(lx + x + layer.offset.x, ly + y + layer.offset.y) / 255;
          const p = (y * out.raster.width + x) * 4 + 3;
          d[p] = d[p]! * m;
        }
      }
    }
    layer.raster.blit(out.raster, lx, ly);
    ctx.exec(PaintCommand.finish(layer, captured, `Text: ${text.slice(0, 24)}`, target), { alreadyApplied: true, noMerge: true });
  }
}
