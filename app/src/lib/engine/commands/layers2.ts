/**
 * Wave-5 layer commands: masks, clipping, locks, fill opacity, effects, adjustment /
 * fill / shape / text specs, linking, color. All are plain prop swaps (cheap undo);
 * continuous ones (fill opacity, adjustment params, effects) merge consecutive ticks.
 */

import { Raster } from "../raster";
import { Selection } from "../selection";
import { getLayer, getPixelLayer, rerasterizeShape, rerasterizeText, setLayerProps, layerDocRect, findLayer } from "../document";
import { assertEditable } from "../locks";
import { cloneEffects } from "../ops/effects";
import { invalidateFillLayer } from "../layer-source";
import type { ParamValues } from "../ops/types";
import type {
  Command,
  Document,
  FillSpec,
  FillRule,
  GradientFill,
  Layer,
  LayerColor,
  LayerDirtyRegion,
  LayerEffects,
  LayerId,
  LayerLock,
  Path,
  SolidFill,
  StrokeSpec,
  TextSpec,
} from "../types";
import { SetLayerPropsCommand } from "./layers";

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/** A mask raster the size of the layer's raster (document-sized for non-pixel layers). */
export function maskSizeFor(doc: Document, layer: Layer): { w: number; h: number } {
  const r = layerDocRect(doc, layer);
  return layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text" ? { w: r.w, h: r.h } : { w: doc.width, h: doc.height };
}

/** "Reveal All" mask (white). */
export function maskRevealAll(doc: Document, layer: Layer): Raster {
  const { w, h } = maskSizeFor(doc, layer);
  return Raster.filled(w, h, { r: 255, g: 255, b: 255, a: 255 });
}

/** "Hide All" mask (black). */
export function maskHideAll(doc: Document, layer: Layer): Raster {
  const { w, h } = maskSizeFor(doc, layer);
  return Raster.filled(w, h, { r: 0, g: 0, b: 0, a: 255 });
}

/** "Reveal Selection" / "Hide Selection" mask built from the document selection. */
export function maskFromSelection(doc: Document, layer: Layer, reveal = true): Raster {
  const { w, h } = maskSizeFor(doc, layer);
  const m = new Raster(w, h);
  const d = m.data;
  const sel = doc.selection;
  const isPixel = layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text";
  const ox = isPixel ? layer.offset.x : 0;
  const oy = isPixel ? layer.offset.y : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = sel.get(x + ox, y + oy);
      if (!reveal) v = 255 - v;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return m;
}

/** Install (or remove, with `null`) a layer mask. */
export class SetLayerMaskCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private readonly next: Raster | null;
  private prev: Raster | null | undefined;
  private prevEnabled = true;

  constructor(layerId: LayerId, mask: Raster | null, label?: string) {
    this.layerId = layerId;
    this.next = mask;
    this.label = label ?? (mask ? "Add Layer Mask" : "Delete Layer Mask");
  }

  do(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (this.prev === undefined) {
      this.prev = l.mask;
      this.prevEnabled = l.maskEnabled;
    }
    l.mask = this.next;
    if (this.next) l.maskEnabled = true;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    l.mask = this.prev ?? null;
    l.maskEnabled = this.prevEnabled;
    doc.dirty = true;
  }

  byteSize(): number {
    return (this.next?.byteLength() ?? 0) + (this.prev?.byteLength() ?? 0);
  }
}

/** Layer ▸ Layer Mask ▸ Apply: bake the mask into the pixels' alpha and remove it. */
export class ApplyMaskCommand implements Command {
  readonly label = "Apply Layer Mask";
  readonly layerId: LayerId;
  private prev: { raster: Raster; mask: Raster | null; enabled: boolean } | null = null;
  private next: Raster | null = null;

  constructor(layerId: LayerId) {
    this.layerId = layerId;
  }

  do(doc: Document): void {
    const l = getPixelLayer(doc, this.layerId);
    assertEditable(l, "pixels");
    if (!l.mask) return;
    if (!this.prev) {
      this.prev = { raster: l.raster, mask: l.mask, enabled: l.maskEnabled };
      const out = l.raster.clone();
      if (l.maskEnabled) {
        const d = out.data;
        const m = l.mask.data;
        const n = Math.min(d.length, m.length);
        for (let i = 0; i < n; i += 4) d[i + 3] = (d[i + 3]! * m[i]!) / 255;
      }
      this.next = out;
    }
    l.raster = this.next!;
    l.mask = null;
    l.maskEnabled = true;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    if (!this.prev) return;
    const l = getPixelLayer(doc, this.layerId);
    l.raster = this.prev.raster;
    l.mask = this.prev.mask;
    l.maskEnabled = this.prev.enabled;
    doc.dirty = true;
  }

  byteSize(): number {
    return (this.next?.byteLength() ?? 0) + (this.prev?.mask?.byteLength() ?? 0);
  }
}

export class SetMaskEnabledCommand extends SetLayerPropsCommand {
  constructor(layerId: LayerId, enabled: boolean) {
    super(layerId, { maskEnabled: enabled }, enabled ? "Enable Layer Mask" : "Disable Layer Mask");
  }
}

export class SetMaskLinkedCommand extends SetLayerPropsCommand {
  constructor(layerId: LayerId, linked: boolean) {
    super(layerId, { maskLinked: linked }, linked ? "Link Layer Mask" : "Unlink Layer Mask");
  }
}

// ---------------------------------------------------------------------------
// Clipping, fill opacity, color, locks
// ---------------------------------------------------------------------------

export class SetClipToBelowCommand extends SetLayerPropsCommand {
  constructor(layerId: LayerId, clip: boolean) {
    super(layerId, { clipToBelow: clip }, clip ? "Create Clipping Mask" : "Release Clipping Mask");
  }
}

export class SetFillOpacityCommand extends SetLayerPropsCommand {
  constructor(layerId: LayerId, fillOpacity: number) {
    super(layerId, { fillOpacity }, "Fill Opacity");
  }
}

export class SetLayerColorCommand extends SetLayerPropsCommand {
  constructor(layerId: LayerId, color: LayerColor | null) {
    super(layerId, { color }, "Layer Color");
  }
}

/** Set the four lock toggles (partial update). Keeps the legacy `locked` flag in sync with `lock.all`. */
export class SetLayerLockCommand implements Command {
  readonly label = "Lock Layer";
  readonly layerId: LayerId;
  private readonly next: Partial<LayerLock>;
  private prev: { lock: LayerLock; locked: boolean } | null = null;

  constructor(layerId: LayerId, lock: Partial<LayerLock>) {
    this.layerId = layerId;
    this.next = { ...lock };
  }

  do(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (!this.prev) this.prev = { lock: { ...l.lock }, locked: l.locked };
    l.lock = { ...l.lock, ...this.next };
    l.locked = l.lock.all;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    if (!this.prev) return;
    const l = getLayer(doc, this.layerId);
    l.lock = { ...this.prev.lock };
    l.locked = this.prev.locked;
    doc.dirty = true;
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Replace a layer's effects (deep-copied). Consecutive edits merge (live Layer Style dialog). */
export class SetLayerEffectsCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private next: LayerEffects | null;
  private prev: LayerEffects | null | undefined;

  constructor(layerId: LayerId, effects: LayerEffects | null, label = "Layer Style") {
    this.layerId = layerId;
    this.next = cloneEffects(effects);
    this.label = label;
  }

  do(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (this.prev === undefined) this.prev = l.effects;
    l.effects = cloneEffects(this.next);
    doc.dirty = true;
  }

  undo(doc: Document): void {
    getLayer(doc, this.layerId).effects = this.prev ?? null;
    doc.dirty = true;
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetLayerEffectsCommand) || next.layerId !== this.layerId || next.label !== this.label) return false;
    this.next = cloneEffects(next.next);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Adjustment / fill / shape / text specs
// ---------------------------------------------------------------------------

/** Merge new parameter values into an adjustment layer (consecutive ticks coalesce). */
export class SetAdjustmentParamsCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private next: ParamValues;
  private readonly op: string | undefined;
  private prev: { params: ParamValues; op: string } | null = null;

  constructor(layerId: LayerId, params: ParamValues, opts: { op?: string; label?: string } = {}) {
    this.layerId = layerId;
    this.next = { ...params };
    this.op = opts.op;
    this.label = opts.label ?? "Adjustment";
  }

  do(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "adjustment") throw new Error(`Layer ${this.layerId} is not an adjustment layer`);
    if (!this.prev) this.prev = { params: { ...l.params }, op: l.op };
    l.params = { ...l.params, ...this.next };
    if (this.op) l.op = this.op;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "adjustment" || !this.prev) return;
    l.params = { ...this.prev.params };
    l.op = this.prev.op;
    doc.dirty = true;
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetAdjustmentParamsCommand) || next.layerId !== this.layerId || next.op !== undefined) return false;
    this.next = { ...this.next, ...next.next };
    return true;
  }
}

/** Replace a fill layer's spec. */
export class SetFillLayerCommand implements Command {
  readonly label = "Fill Layer";
  readonly layerId: LayerId;
  private next: FillSpec;
  private prev: FillSpec | null = null;

  constructor(layerId: LayerId, fill: FillSpec) {
    this.layerId = layerId;
    this.next = fill;
  }

  do(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "fill") throw new Error(`Layer ${this.layerId} is not a fill layer`);
    if (!this.prev) this.prev = l.fill;
    l.fill = this.next;
    invalidateFillLayer(l);
    doc.dirty = true;
  }

  undo(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "fill" || !this.prev) return;
    l.fill = this.prev;
    invalidateFillLayer(l);
    doc.dirty = true;
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetFillLayerCommand) || next.layerId !== this.layerId) return false;
    this.next = next.next;
    return true;
  }
}

export interface ShapeLayerSpec {
  path?: Path;
  fill?: SolidFill | GradientFill | null;
  stroke?: StrokeSpec | null;
  fillRule?: FillRule;
}

/** Edit a shape layer's path / fill / stroke and re-rasterize. */
export class SetShapeLayerCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private next: ShapeLayerSpec;
  private prev: { spec: Required<ShapeLayerSpec>; raster: Raster } | null = null;
  private nextRaster: Raster | null = null;

  constructor(layerId: LayerId, spec: ShapeLayerSpec, label = "Edit Shape") {
    this.layerId = layerId;
    this.next = spec;
    this.label = label;
  }

  do(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "shape") throw new Error(`Layer ${this.layerId} is not a shape layer`);
    assertEditable(l, "pixels");
    if (!this.prev) this.prev = { spec: { path: l.path, fill: l.fill, stroke: l.stroke, fillRule: l.fillRule }, raster: l.raster };
    if (this.next.path !== undefined) l.path = this.next.path;
    if (this.next.fill !== undefined) l.fill = this.next.fill;
    if (this.next.stroke !== undefined) l.stroke = this.next.stroke;
    if (this.next.fillRule !== undefined) l.fillRule = this.next.fillRule;
    if (!this.nextRaster) this.nextRaster = rerasterizeShape(doc, l);
    else l.raster = this.nextRaster;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "shape" || !this.prev) return;
    l.path = this.prev.spec.path;
    l.fill = this.prev.spec.fill;
    l.stroke = this.prev.spec.stroke;
    l.fillRule = this.prev.spec.fillRule;
    l.raster = this.prev.raster;
    doc.dirty = true;
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetShapeLayerCommand) || next.layerId !== this.layerId || next.label !== this.label) return false;
    this.next = { ...this.next, ...next.next };
    this.nextRaster = null;
    return true;
  }

  byteSize(): number {
    return (this.nextRaster?.byteLength() ?? 0) + (this.prev?.raster.byteLength() ?? 0);
  }
}

/** Edit a text layer's spec and re-rasterize. */
export class SetTextLayerCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private next: Partial<TextSpec>;
  private prev: { text: TextSpec; raster: Raster } | null = null;
  private nextRaster: Raster | null = null;

  constructor(layerId: LayerId, text: Partial<TextSpec>, label = "Edit Type") {
    this.layerId = layerId;
    this.next = { ...text };
    this.label = label;
  }

  do(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "text") throw new Error(`Layer ${this.layerId} is not a text layer`);
    assertEditable(l, "pixels");
    if (!this.prev) this.prev = { text: l.text, raster: l.raster };
    l.text = { ...l.text, ...this.next };
    if (!this.nextRaster) this.nextRaster = rerasterizeText(doc, l);
    else l.raster = this.nextRaster;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    const l = getLayer(doc, this.layerId);
    if (l.kind !== "text" || !this.prev) return;
    l.text = this.prev.text;
    l.raster = this.prev.raster;
    doc.dirty = true;
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetTextLayerCommand) || next.layerId !== this.layerId || next.label !== this.label) return false;
    this.next = { ...this.next, ...next.next };
    this.nextRaster = null;
    return true;
  }

  byteSize(): number {
    return (this.nextRaster?.byteLength() ?? 0) + (this.prev?.raster.byteLength() ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Linking & moving
// ---------------------------------------------------------------------------

/** Link (or unlink) a set of layers so the Move tool moves them together. */
export class LinkLayersCommand implements Command {
  readonly label: string;
  private readonly ids: LayerId[];
  private readonly link: boolean;
  private prev = new Map<LayerId, LayerId[]>();

  constructor(ids: readonly LayerId[], link = true) {
    this.ids = [...new Set(ids)];
    this.link = link;
    this.label = link ? "Link Layers" : "Unlink Layers";
  }

  do(doc: Document): void {
    this.prev.clear();
    for (const id of this.ids) {
      const l = findLayer(doc, id);
      if (l) this.prev.set(id, l.linkedTo.slice());
    }
    if (this.link) {
      // Every member links to every other member (and to anything they were already linked to).
      const all = new Set<LayerId>(this.ids);
      for (const id of this.ids) for (const x of findLayer(doc, id)?.linkedTo ?? []) all.add(x);
      for (const id of all) {
        const l = findLayer(doc, id);
        if (!l) continue;
        if (!this.prev.has(id)) this.prev.set(id, l.linkedTo.slice());
        l.linkedTo = [...all].filter((x) => x !== id);
      }
    } else {
      const set = new Set(this.ids);
      for (const l of doc.layers) {
        if (set.has(l.id)) {
          l.linkedTo = [];
        } else if (l.linkedTo.some((x) => set.has(x))) {
          if (!this.prev.has(l.id)) this.prev.set(l.id, l.linkedTo.slice());
          l.linkedTo = l.linkedTo.filter((x) => !set.has(x));
        }
      }
    }
    doc.dirty = true;
  }

  undo(doc: Document): void {
    for (const [id, linked] of this.prev) {
      const l = findLayer(doc, id);
      if (l) l.linkedTo = linked.slice();
    }
    doc.dirty = true;
  }
}

/** All layers that move together with `id` (itself, linked layers, transitively). */
export function linkedSet(doc: Document, id: LayerId): LayerId[] {
  const out = new Set<LayerId>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const x of findLayer(doc, cur)?.linkedTo ?? []) stack.push(x);
  }
  return [...out];
}

/**
 * Move layers by a delta (Move tool). Honours `lock.position` (throws), moves linked
 * layers together when `followLinks`, keeps unlinked masks in place in document space
 * and translates shape paths / text origins. Consecutive moves of the same set merge.
 */
export class MoveLayersCommand implements Command {
  readonly label = "Move";
  private readonly ids: LayerId[];
  private dx: number;
  private dy: number;
  private prevMasks = new Map<LayerId, Raster | null>();
  private applied = false;

  constructor(doc: Document, ids: readonly LayerId[], dx: number, dy: number, followLinks = true) {
    const set = new Set<LayerId>();
    for (const id of ids) for (const x of followLinks ? linkedSet(doc, id) : [id]) set.add(x);
    this.ids = [...set];
    this.dx = Math.round(dx);
    this.dy = Math.round(dy);
  }

  get layerIds(): readonly LayerId[] {
    return this.ids;
  }

  private shift(doc: Document, dx: number, dy: number): void {
    for (const id of this.ids) {
      const l = findLayer(doc, id);
      if (!l || l.kind === "group") continue;
      assertEditable(l, "position");
      if (l.kind === "adjustment" || l.kind === "fill") {
        // Canvas-sized layers: only the mask moves (PS moves the mask of a fill layer).
        if (l.mask && l.maskLinked) l.mask = translateRaster(l.mask, dx, dy, 255);
        continue;
      }
      l.offset = { x: l.offset.x + dx, y: l.offset.y + dy };
      if (l.mask && !l.maskLinked) l.mask = translateRaster(l.mask, -dx, -dy, 255);
    }
    doc.dirty = true;
  }

  do(doc: Document): void {
    if (!this.applied) {
      for (const id of this.ids) this.prevMasks.set(id, findLayer(doc, id)?.mask ?? null);
      this.applied = true;
    }
    this.shift(doc, this.dx, this.dy);
  }

  undo(doc: Document): void {
    this.shift(doc, -this.dx, -this.dy);
    for (const [id, m] of this.prevMasks) {
      const l = findLayer(doc, id);
      if (l) l.mask = m;
    }
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof MoveLayersCommand)) return false;
    if (next.ids.length !== this.ids.length || !next.ids.every((x) => this.ids.includes(x))) return false;
    this.dx += next.dx;
    this.dy += next.dy;
    return true;
  }

  affected(): readonly LayerDirtyRegion[] {
    return [];
  }
}

/** Copy of a raster shifted by `dx, dy`; uncovered pixels get gray `fill` (opaque). */
export function translateRaster(src: Raster, dx: number, dy: number, fill: number): Raster {
  const out = Raster.filled(src.width, src.height, { r: fill, g: fill, b: fill, a: 255 });
  out.blit(src, dx, dy, undefined, { mode: "replace" });
  return out;
}

/** Selection from a pixel layer's alpha (Ctrl-click thumbnail). */
export function selectionFromLayer(doc: Document, layerId: LayerId): Selection | null {
  const l = findLayer(doc, layerId);
  if (!l || !(l.kind === "raster" || l.kind === "shape" || l.kind === "text")) return null;
  return Selection.fromLayerAlpha(l.raster, { size: { w: doc.width, h: doc.height }, offset: l.offset });
}

/** Convenience: set `passThrough` on a group. */
export class SetGroupPassThroughCommand extends SetLayerPropsCommand {
  constructor(layerId: LayerId, passThrough: boolean) {
    super(layerId, { passThrough }, passThrough ? "Pass Through" : "Isolate Group");
  }
}

/** Re-export so tools can import everything layer-related from one place. */
export { setLayerProps };
