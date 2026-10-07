/**
 * Shape tools (U): Rectangle, Rounded Rectangle, Ellipse, Polygon (+ star), Line (+ arrowheads),
 * Custom Shape. Mode Shape → new shape layer (`createShapeLayer` + `AddLayerCommand`),
 * Path → work path subpath, Pixels → filled into the active raster layer.
 */
import { Square, Squircle, Circle, Pentagon, Minus, Shapes } from "@lucide/svelte";
import {
  AddLayerCommand,
  PaintCommand,
  Rect,
  Selection,
  clonePath,
  createShapeLayer,
  ellipsePath,
  fillPathToRaster,
  newId,
  pathCoverage,
  rectPath,
  roundedRectPath,
  strokePathToRaster,
  type GradientFill,
  type Path,
  type Point,
  type SolidFill,
  type StrokeSpec,
} from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { resolvePaintTarget } from "./paint-target";
import { drawPath } from "./path-overlay";
import { customShapePath } from "./custom-shapes";
import { fitPathToRect, lineShape, polygonShape, shapeDragRect, shapeId } from "./shape-geom";
import { commitWorkPath, workPathOf } from "./work-path";

export const PEN_MODE_OPTION: ToolOption = {
  kind: "select",
  key: "mode",
  label: "",
  choices: [
    { value: "shape", label: "Shape" },
    { value: "path", label: "Path" },
    { value: "pixels", label: "Pixels" },
  ],
  default: "shape",
};
export const SHAPE_FILL_OPTION: ToolOption = { kind: "custom", key: "fill", renderer: "fill-picker", label: "Fill", default: JSON.stringify({ type: "solid", color: { r: 20, g: 115, b: 230, a: 255 } }) };
export const SHAPE_STROKE_OPTION: ToolOption = { kind: "custom", key: "stroke", renderer: "fill-picker", label: "Stroke", default: "null", props: { allowNone: true } };
export const STROKE_WIDTH_OPTION: ToolOption = { kind: "number", key: "strokeWidth", label: "", min: 0, max: 500, step: 0.5, default: 1, unit: "px", slider: false };
const STROKE_ALIGN_OPTION: ToolOption = {
  kind: "select",
  key: "strokeAlign",
  label: "Align",
  choices: [
    { value: "inside", label: "Inside" },
    { value: "center", label: "Center" },
    { value: "outside", label: "Outside" },
  ],
  default: "inside",
};
const STROKE_DASH_OPTION: ToolOption = {
  kind: "select",
  key: "strokeDash",
  label: "",
  choices: [
    { value: "solid", label: "Solid" },
    { value: "dash", label: "Dashed" },
    { value: "dot", label: "Dotted" },
  ],
  default: "solid",
};

export type ShapeFillValue = SolidFill | GradientFill | null;

/** Parse a stored fill option (JSON) safely. */
export function parseFill(v: string | undefined | null): ShapeFillValue {
  if (!v || v === "null") return null;
  try {
    const o = JSON.parse(v) as ShapeFillValue;
    if (o && (o.type === "solid" || o.type === "gradient")) return o;
  } catch {
    /* ignore */
  }
  return null;
}

/** Stroke spec from the options bar, or null. */
export function strokeFromOptions(ctx: ToolContext): StrokeSpec | null {
  const fill = parseFill(ctx.opt<string>("stroke"));
  const width = ctx.opt<number>("strokeWidth");
  if (!fill || width <= 0) return null;
  const dash = ctx.opt<string>("strokeDash");
  return {
    width,
    fill,
    position: (ctx.opt<string>("strokeAlign") || "inside") as StrokeSpec["position"],
    cap: dash === "dot" ? "round" : "butt",
    join: "miter",
    dash: dash === "dash" ? [width * 3, width * 2] : dash === "dot" ? [0.01, width * 2] : null,
  };
}

/** Create a shape layer / work path / pixels from a finished path according to the tool mode. */
export function createShapeFromPath(ctx: ToolContext, path: Path, label: string): void {
  const mode = ctx.opt<string>("mode") || "shape";
  if (mode === "path") {
    const before = workPathOf(ctx);
    const next = clonePath(before);
    next.subpaths.push(...clonePath(path).subpaths);
    commitWorkPath(ctx, before, next, `${label} Path`);
    return;
  }
  if (mode === "pixels") {
    const target = resolvePaintTarget(ctx, "fill");
    if (!target || target.kind !== "layer" || !target.layer || target.layer.kind !== "raster") return;
    const layer = target.layer;
    const w = ctx.doc.width;
    const h = ctx.doc.height;
    const fill = parseFill(ctx.opt<string>("fill")) ?? { type: "solid", color: ctx.fg() };
    const fillRaster = fillPathToRaster(path, fill, w, h);
    const stroke = strokeFromOptions(ctx);
    if (stroke) {
      const sr = strokePathToRaster(path, stroke.width, stroke.fill, { cap: stroke.cap, join: stroke.join, dash: stroke.dash }, w, h);
      fillRaster.blit(sr, 0, 0);
    }
    const cov = pathCoverage(path, w, h);
    const sel = Selection.fromMask(w, h, cov).expand(Math.ceil(stroke?.width ?? 0) + 1);
    const bb = sel.bbox;
    if (!bb) return;
    const area = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
    if (Rect.isEmpty(area)) return;
    const captured = PaintCommand.capture(layer, area);
    const docSel = ctx.doc.selection;
    if (!docSel.isEmpty) {
      const d = fillRaster.data;
      for (let i = 0, p = 3; i < docSel.mask.length; i++, p += 4) d[p] = (d[p]! * docSel.mask[i]!) / 255;
    }
    layer.raster.blit(fillRaster, -layer.offset.x, -layer.offset.y, Rect.translate(area, layer.offset.x, layer.offset.y));
    ctx.exec(PaintCommand.finish(layer, captured, `${label} (Pixels)`, area), { alreadyApplied: true, noMerge: true });
    return;
  }
  const doc = ctx.doc;
  const fill = parseFill(ctx.opt<string>("fill"));
  const stroke = strokeFromOptions(ctx);
  const layer = createShapeLayer(doc, { id: newId("shape"), name: `${path.name} 1`, path: { ...clonePath(path), name: path.name }, fill, stroke });
  const active = doc.activeLayerId ? doc.layers.findIndex((l) => l.id === doc.activeLayerId) : -1;
  ctx.exec(new AddLayerCommand(layer, active >= 0 ? active + 1 : undefined, `${label} Tool`), { noMerge: true });
  ctx.setActiveLayer(layer.id);
}

export type ShapeKind = "rect" | "rounded" | "ellipse" | "polygon" | "line" | "custom";

export class ShapeTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut = "u";
  readonly group = "shape";
  readonly groupOrder: number;
  readonly cursor = "crosshair";
  readonly hint: string;
  readonly options: readonly ToolOption[];
  readonly kind: ShapeKind;

  private anchor: Point | null = null;
  private cur: Point | null = null;
  private preview: Path | null = null;

  constructor(kind: ShapeKind) {
    this.kind = kind;
    const defs: Record<ShapeKind, { id: string; name: string; icon: typeof Square; order: number; hint: string }> = {
      rect: { id: "shape-rect", name: "Rectangle", icon: Square, order: 0, hint: "Drag to draw a rectangle. Shift = square, Alt = from centre." },
      rounded: { id: "shape-rounded", name: "Rounded Rectangle", icon: Squircle, order: 1, hint: "Drag to draw a rounded rectangle. Radius in the options bar." },
      ellipse: { id: "shape-ellipse", name: "Ellipse", icon: Circle, order: 2, hint: "Drag to draw an ellipse. Shift = circle, Alt = from centre." },
      polygon: { id: "shape-polygon", name: "Polygon", icon: Pentagon, order: 3, hint: "Drag from the centre outwards. Sides and Star options in the bar." },
      line: { id: "shape-line", name: "Line", icon: Minus, order: 4, hint: "Drag to draw a line. Shift constrains to 45°. Arrowheads in the options bar." },
      custom: { id: "shape-custom", name: "Custom Shape", icon: Shapes, order: 5, hint: "Pick a shape in the options bar, then drag. Shift keeps proportions." },
    };
    const d = defs[kind];
    this.id = d.id;
    this.name = d.name;
    this.icon = d.icon;
    this.groupOrder = d.order;
    this.hint = d.hint;
    const common: ToolOption[] = [PEN_MODE_OPTION, SHAPE_FILL_OPTION, SHAPE_STROKE_OPTION, STROKE_WIDTH_OPTION, STROKE_ALIGN_OPTION, STROKE_DASH_OPTION];
    const extra: ToolOption[] =
      kind === "rounded"
        ? [{ kind: "number", key: "radius", label: "Radius", min: 0, max: 1000, step: 1, default: 10, unit: "px", slider: false }]
        : kind === "polygon"
          ? [
              { kind: "number", key: "sides", label: "Sides", min: 3, max: 100, step: 1, default: 5, slider: false },
              { kind: "toggle", key: "star", label: "Star", default: false },
              { kind: "number", key: "indent", label: "Indent", min: 1, max: 99, step: 1, default: 50, unit: "%", slider: false },
              { kind: "toggle", key: "smooth", label: "Smooth Corners", default: false },
            ]
          : kind === "line"
            ? [
                { kind: "number", key: "weight", label: "Weight", min: 1, max: 1000, step: 1, default: 4, unit: "px", slider: false },
                { kind: "toggle", key: "arrowStart", label: "Start", default: false },
                { kind: "toggle", key: "arrowEnd", label: "End", default: false },
                { kind: "number", key: "arrowWidth", label: "Width", min: 10, max: 1000, step: 10, default: 500, unit: "%", slider: false },
                { kind: "number", key: "arrowLength", label: "Length", min: 10, max: 5000, step: 10, default: 1000, unit: "%", slider: false },
                { kind: "number", key: "concavity", label: "Concavity", min: -50, max: 50, step: 1, default: 0, unit: "%", slider: false },
              ]
            : kind === "custom"
              ? [{ kind: "custom", key: "shape", renderer: "shape-picker", label: "Shape", default: "heart" }]
              : [];
    this.options = [...common, ...extra];
  }

  buildPath(ctx: ToolContext, a: Point, b: Point, mods: { shiftKey: boolean; altKey: boolean }): Path | null {
    const k = this.kind;
    if (k === "line") {
      let end = b;
      if (mods.shiftKey) {
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        end = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
      }
      if (Math.hypot(end.x - a.x, end.y - a.y) < 1) return null;
      return lineShape(a, end, ctx.opt<number>("weight"), {
        start: ctx.opt<boolean>("arrowStart"),
        end: ctx.opt<boolean>("arrowEnd"),
        width: ctx.opt<number>("arrowWidth"),
        length: ctx.opt<number>("arrowLength"),
        concavity: ctx.opt<number>("concavity"),
      });
    }
    if (k === "polygon") {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      if (r < 1) return null;
      const rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const p = polygonShape(a, r, ctx.opt<number>("sides"), { star: ctx.opt<boolean>("star"), indent: ctx.opt<number>("indent"), rotation: mods.shiftKey ? -90 : rot });
      if (ctx.opt<boolean>("smooth")) {
        for (const sp of p.subpaths) {
          const n = sp.anchors.length;
          sp.anchors.forEach((an, i) => {
            const prev = sp.anchors[(i - 1 + n) % n]!;
            const next = sp.anchors[(i + 1) % n]!;
            const tx = next.x - prev.x;
            const ty = next.y - prev.y;
            const len = Math.hypot(tx, ty) || 1;
            const dd = Math.hypot(next.x - an.x, next.y - an.y) / 3;
            an.type = "smooth";
            an.outX = an.x + (tx / len) * dd;
            an.outY = an.y + (ty / len) * dd;
            an.inX = an.x - (tx / len) * dd;
            an.inY = an.y - (ty / len) * dd;
          });
        }
      }
      return p;
    }
    const r = shapeDragRect(a, b, mods.shiftKey, mods.altKey);
    if (r.w < 1 || r.h < 1) return null;
    if (k === "rect") return { ...rectPath(r), id: shapeId() };
    if (k === "rounded") return { ...roundedRectPath(r, ctx.opt<number>("radius")), id: shapeId() };
    if (k === "ellipse") return { ...ellipsePath(r), id: shapeId() };
    const unit = customShapePath(ctx.opt<string>("shape"));
    return fitPathToRect(unit, r);
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.anchor = { x: e.x, y: e.y };
    this.cur = this.anchor;
    this.preview = null;
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (!this.anchor) return;
    this.cur = { x: e.x, y: e.y };
    this.preview = this.buildPath(ctx, this.anchor, this.cur, e);
    ctx.invalidateOverlay();
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const a = this.anchor;
    this.anchor = null;
    this.cur = null;
    this.preview = null;
    ctx.invalidateOverlay();
    if (!a) return;
    const path = this.buildPath(ctx, a, { x: e.x, y: e.y }, e);
    if (!path) return;
    createShapeFromPath(ctx, path, this.name);
  }

  cancel(ctx: ToolContext): void {
    this.anchor = null;
    this.cur = null;
    this.preview = null;
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (this.preview) drawPath(g, ctx.viewport, this.preview, { anchors: false });
    const wp = ctx.opt<string>("mode") === "path" ? workPathOf(ctx) : null;
    if (wp && wp.subpaths.length) drawPath(g, ctx.viewport, wp, { anchors: false });
  }
}
