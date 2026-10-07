/**
 * Magnetic Lasso (L): the outline snaps to the strongest Sobel edge within `width` px of
 * the pointer; fastening points drop automatically every `frequency` distance. Click adds a
 * manual point, Alt-click/drag adds straight segments, Backspace removes the last
 * fastening point, Enter / double-click / clicking the first point closes.
 */
import { Magnet } from "@lucide/svelte";
import { Selection, SetSelectionCommand, compositeToRaster, type Point } from "$lib/engine";
import type { SelectionMode, Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { combineSelection, featherIf, modeFromModifiers, selectionLabel } from "./selection-mod";
import { strokeOutline } from "./util";
import { EdgeMapCache, snapToEdge, type EdgeMap } from "./edge-map";

interface Fastening {
  /** Index into `points` of this fastening point. */
  index: number;
}

export class MagneticLassoTool implements Tool {
  readonly id = "lasso-magnetic";
  readonly name = "Magnetic Lasso";
  readonly icon = Magnet;
  readonly shortcut = "l";
  readonly group = "lasso";
  readonly groupOrder = 2;
  readonly cursor = "crosshair";
  readonly hint = "Click to start, move along an edge; points fasten automatically. Click adds a point, Backspace removes one, Enter or double-click closes.";
  readonly options: readonly ToolOption[] = [
    {
      kind: "select",
      key: "mode",
      label: "Mode",
      choices: [
        { value: "new", label: "New" },
        { value: "add", label: "Add" },
        { value: "subtract", label: "Subtract" },
        { value: "intersect", label: "Intersect" },
      ],
      default: "new",
    },
    { kind: "number", key: "feather", label: "Feather", min: 0, max: 250, step: 1, default: 0, unit: "px", slider: false },
    { kind: "toggle", key: "antialias", label: "Anti-alias", default: true },
    { kind: "number", key: "width", label: "Width", min: 1, max: 256, step: 1, default: 10, unit: "px", slider: false },
    { kind: "number", key: "contrast", label: "Contrast", min: 1, max: 100, step: 1, default: 10, unit: "%", slider: false },
    { kind: "number", key: "frequency", label: "Frequency", min: 0, max: 100, step: 1, default: 57, slider: false },
  ];

  private points: Point[] = [];
  private fastenings: Fastening[] = [];
  private preview: Point[] = [];
  private mode: SelectionMode = "new";
  private lastClickAt = 0;
  private sinceFasten = 0;
  private readonly edges = new EdgeMapCache();
  private hover: Point | null = null;

  private edgeMap(ctx: ToolContext): EdgeMap {
    const e = ctx.entry;
    return this.edges.get(`${e.id}:${e.pixelVersion}`, () => compositeToRaster(ctx.doc));
  }

  /** Spacing between automatic fastening points (PS frequency 0..100 → ~100..5 px). */
  static fastenSpacing(frequency: number): number {
    return Math.max(5, 100 - frequency * 0.95);
  }

  private snap(ctx: ToolContext, p: Point): Point {
    const edge = this.edgeMap(ctx);
    const width = ctx.opt<number>("width");
    const contrast = ctx.opt<number>("contrast") / 100;
    const hit = snapToEdge(edge, p.x, p.y, width, contrast * edge.max * 0.5);
    return hit ? { x: hit.x + 0.5, y: hit.y + 0.5 } : p;
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const now = performance.now();
    const p = e.altKey ? { x: e.x, y: e.y } : this.snap(ctx, { x: e.x, y: e.y });
    if (this.points.length === 0) {
      this.mode = modeFromModifiers(e, ctx.opt<SelectionMode>("mode"));
      this.points = [p];
      this.fastenings = [{ index: 0 }];
      this.preview = [];
      this.sinceFasten = 0;
      this.lastClickAt = now;
      ctx.invalidateOverlay();
      return;
    }
    const first = this.points[0]!;
    const closeEnough = Math.hypot(first.x - e.x, first.y - e.y) * ctx.viewport.zoom < 8;
    const dbl = now - this.lastClickAt < 350;
    if ((closeEnough && this.points.length >= 3) || dbl) {
      this.commitPreview();
      this.close(ctx);
      this.lastClickAt = 0;
      return;
    }
    // Manual fastening point: commit the preview path and fasten there.
    this.commitPreview();
    this.points.push(p);
    this.fastenings.push({ index: this.points.length - 1 });
    this.sinceFasten = 0;
    this.lastClickAt = now;
    ctx.invalidateOverlay();
  }

  private commitPreview(): void {
    if (this.preview.length) {
      this.points.push(...this.preview);
      this.preview = [];
    }
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    this.hover = { x: e.x, y: e.y };
    if (this.points.length === 0) {
      ctx.invalidateOverlay();
      return;
    }
    const last = this.preview.length ? this.preview[this.preview.length - 1]! : this.points[this.points.length - 1]!;
    const dist = Math.hypot(last.x - e.x, last.y - e.y);
    if (dist * ctx.viewport.zoom < 2) {
      ctx.invalidateOverlay();
      return;
    }
    // Walk from the last point towards the pointer in small steps, snapping each one.
    const steps = Math.max(1, Math.ceil(dist / 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const raw = { x: last.x + (e.x - last.x) * t, y: last.y + (e.y - last.y) * t };
      const snapped = e.altKey ? raw : this.snap(ctx, raw);
      const prev = this.preview.length ? this.preview[this.preview.length - 1]! : last;
      const seg = Math.hypot(snapped.x - prev.x, snapped.y - prev.y);
      this.preview.push(snapped);
      this.sinceFasten += seg;
      const spacing = MagneticLassoTool.fastenSpacing(ctx.opt<number>("frequency"));
      if (this.sinceFasten >= spacing) {
        // Auto-fasten: freeze the preview so Backspace can step back to this point.
        this.points.push(...this.preview);
        this.preview = [];
        this.fastenings.push({ index: this.points.length - 1 });
        this.sinceFasten = 0;
      }
    }
    ctx.invalidateOverlay();
  }

  onPointerUp(): void {}

  private close(ctx: ToolContext): void {
    const pts = this.points;
    this.points = [];
    this.fastenings = [];
    this.preview = [];
    ctx.invalidateOverlay();
    const { width, height } = ctx.doc;
    if (pts.length < 3) {
      if (this.mode === "new" && !ctx.doc.selection.isEmpty) ctx.exec(new SetSelectionCommand(Selection.none(width, height), "Deselect"));
      return;
    }
    let shape = Selection.fromPolygon(width, height, pts, ctx.opt<boolean>("antialias"));
    shape = featherIf(shape, ctx.opt<number>("feather"));
    ctx.exec(new SetSelectionCommand(combineSelection(ctx.doc.selection, shape, this.mode), selectionLabel("Magnetic Lasso", this.mode)));
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down" || this.points.length === 0) return false;
    if (e.key === "Enter") {
      this.commitPreview();
      this.close(ctx);
      return true;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      // Remove the last fastening point and everything after the previous one.
      this.preview = [];
      if (this.fastenings.length > 1) {
        this.fastenings.pop();
        const keep = this.fastenings[this.fastenings.length - 1]!.index;
        this.points.length = keep + 1;
      }
      this.sinceFasten = 0;
      ctx.invalidateOverlay();
      return true;
    }
    if (e.key === "Escape") {
      this.cancel(ctx);
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    this.points = [];
    this.fastenings = [];
    this.preview = [];
    ctx.invalidateOverlay();
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    this.edges.clear();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const vp = ctx.viewport;
    // Width circle around the cursor (PS shows it with Caps Lock; we always do).
    if (this.hover) {
      const s = vp.docToScreen(this.hover);
      const r = ctx.opt<number>("width") * vp.zoom;
      g.save();
      g.strokeStyle = "rgba(255,255,255,0.7)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(s.x, s.y, Math.max(2, r), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    if (this.points.length === 0) return;
    const all = [...this.points, ...this.preview];
    const pts = all.map((p) => vp.docToScreen(p));
    strokeOutline(g, () => {
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      if (this.hover) {
        const h = vp.docToScreen(this.hover);
        g.lineTo(h.x, h.y);
      }
    });
    g.save();
    g.fillStyle = "#fff";
    g.strokeStyle = "#000";
    g.lineWidth = 1;
    for (const f of this.fastenings) {
      const p = pts[f.index];
      if (!p) continue;
      g.beginPath();
      g.rect(Math.round(p.x) - 2.5, Math.round(p.y) - 2.5, 5, 5);
      g.fill();
      g.stroke();
    }
    g.restore();
  }
}
