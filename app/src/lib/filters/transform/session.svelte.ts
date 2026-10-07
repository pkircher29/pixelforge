/**
 * Free Transform session state (Svelte 5 runes).
 *
 * `begin()` lifts the selected pixels (or the whole layer) into a floating raster and
 * blanks them out of the layer so the overlay can draw the live preview. `commit()`
 * resamples the floating raster through the current matrix and pushes a single history
 * entry (`TransformLayerCommand` + optional `SetSelectionCommand` via `CompositeCommand`).
 * `cancel()` restores the layer untouched.
 */

import {
  Raster,
  Rect,
  Selection,
  SetSelectionCommand,
  SetShapeLayerCommand,
  SetTextLayerCommand,
  TransformLayerCommand,
  clonePath,
  type Command,
  type Path,
  type PixelLayer,
  type Point,
} from "$lib/engine";
import { toast } from "$lib/stores/toast.svelte";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { rawDoc, rawLayer } from "../raw";
import { Mat, affineResampleAsync, transformedBounds } from "./affine";
import { CompositeCommand } from "./commands";

export interface TransformParams {
  /** Translation in doc pixels, applied after rotation/scale. */
  tx: number;
  ty: number;
  /** Scale factors (negative = flipped). */
  sx: number;
  sy: number;
  /** Degrees, clockwise. */
  angle: number;
}

export const IDENTITY_PARAMS: TransformParams = { tx: 0, ty: 0, sx: 1, sy: 1, angle: 0 };

export function isIdentityParams(p: TransformParams): boolean {
  return p.tx === 0 && p.ty === 0 && p.sx === 1 && p.sy === 1 && p.angle % 360 === 0;
}

/**
 * Doc-space matrix for a floating raster of `w x h` whose identity position is `origin`.
 * Pivot is the raster centre.
 */
export function transformMatrix(w: number, h: number, origin: Point, p: TransformParams): Mat {
  const cx = origin.x + w / 2 + p.tx;
  const cy = origin.y + h / 2 + p.ty;
  return Mat.chain(
    Mat.translate(-w / 2, -h / 2),
    Mat.scale(p.sx, p.sy),
    Mat.rotate((p.angle * Math.PI) / 180),
    Mat.translate(cx, cy),
  );
}

class TransformSession {
  active = $state(false);
  params = $state<TransformParams>({ ...IDENTITY_PARAMS });
  /** Bumped when the floating raster changes (overlay re-uploads its preview). */
  floatingVersion = $state(0);
  busy = $state(false);

  // Plain (non-reactive) engine objects.
  private entry: OpenDoc | null = null;
  private layerId: string | null = null;
  private floating: Raster | null = null;
  private origin: Point = { x: 0, y: 0 };
  private original: Raster | null = null;
  private originalOffset: Point = { x: 0, y: 0 };
  private working: Raster | null = null;
  private selection: Selection | null = null;

  get doc(): OpenDoc | null {
    return this.entry;
  }

  /** The raw (non-proxied) layer being transformed (pixel, shape or type layer). */
  get layer(): PixelLayer | null {
    if (!this.entry || !this.layerId) return null;
    const l = rawLayer(this.entry, this.layerId);
    return l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text") ? l : null;
  }

  /** The pixels being transformed (identity placement at `floatingOrigin`). */
  get floatingRaster(): Raster | null {
    return this.floating;
  }

  get floatingOrigin(): Point {
    return this.origin;
  }

  get matrix(): Mat {
    const f = this.floating;
    if (!f) return Mat.identity();
    return transformMatrix(f.width, f.height, this.origin, this.params);
  }

  /** Doc-space bounds of the transformed raster. */
  get bounds(): Rect {
    const f = this.floating;
    if (!f) return Rect.empty();
    return transformedBounds(f.width, f.height, this.matrix);
  }

  /** Doc-space corners (TL, TR, BR, BL) of the transformed raster. */
  corners(): [Point, Point, Point, Point] {
    const f = this.floating;
    const m = this.matrix;
    const w = f?.width ?? 0;
    const h = f?.height ?? 0;
    return [Mat.apply(m, { x: 0, y: 0 }), Mat.apply(m, { x: w, y: 0 }), Mat.apply(m, { x: w, y: h }), Mat.apply(m, { x: 0, y: h })];
  }

  /** Start a session on the active pixel, shape or type layer. Returns false (and does nothing) if impossible. */
  begin(): boolean {
    if (this.active) return true;
    const entry = docStore.active;
    const active = docStore.activeLayer;
    if (!entry || !active || (active.kind !== "raster" && active.kind !== "shape" && active.kind !== "text")) return false;
    // Mutate the raw objects only (see raw.ts).
    const doc = rawDoc(entry);
    const raw = rawLayer(entry, active.id);
    const layer = raw && (raw.kind === "raster" || raw.kind === "shape" || raw.kind === "text") ? raw : null;
    if (!layer || layer.locked || layer.lock.all || layer.lock.position) return false;
    // Vector (shape / type) layers always transform as a whole, like PS.
    const sel = layer.kind === "raster" ? doc.selection : new Selection(doc.width, doc.height);
    this.entry = entry;
    this.layerId = layer.id;
    this.original = layer.raster;
    this.originalOffset = { ...layer.offset };
    this.selection = null;

    if (!sel.isEmpty && sel.bbox) {
      const layerRect = Rect.make(layer.offset.x, layer.offset.y, layer.raster.width, layer.raster.height);
      const docRect = Rect.intersect(sel.bbox, layerRect);
      if (Rect.isEmpty(docRect)) return false;
      const local = Rect.translate(docRect, -layer.offset.x, -layer.offset.y);
      const floating = layer.raster.crop(local);
      const working = layer.raster.clone();
      // Apply the soft mask: floating alpha *= coverage; working alpha *= (1 - coverage).
      const fd = floating.data;
      const wd = working.data;
      const m = sel.mask;
      for (let y = 0; y < local.h; y++) {
        let fi = y * local.w * 4 + 3;
        let wi = ((local.y + y) * layer.raster.width + local.x) * 4 + 3;
        let mi = (docRect.y + y) * sel.width + docRect.x;
        for (let x = 0; x < local.w; x++, fi += 4, wi += 4, mi++) {
          const cov = m[mi]!;
          if (cov === 255) {
            wd[wi] = 0;
          } else if (cov === 0) {
            fd[fi] = 0;
          } else {
            fd[fi] = (fd[fi]! * cov) / 255;
            wd[wi] = (wd[wi]! * (255 - cov)) / 255;
          }
        }
      }
      this.floating = floating;
      this.origin = { x: docRect.x, y: docRect.y };
      this.working = working;
      this.selection = sel;
      layer.raster = working;
    } else {
      // PS: the bounding box hugs the layer's non-transparent content, not the canvas.
      const bb = layer.raster.boundingBoxOfAlpha(0);
      if (!bb) return false;
      const whole = bb.x === 0 && bb.y === 0 && bb.w === layer.raster.width && bb.h === layer.raster.height;
      this.floating = whole ? layer.raster : layer.raster.crop(bb);
      this.origin = { x: layer.offset.x + bb.x, y: layer.offset.y + bb.y };
      this.working = new Raster(layer.raster.width, layer.raster.height);
      layer.raster = this.working;
    }
    this.params = { ...IDENTITY_PARAMS };
    this.active = true;
    this.floatingVersion++;
    docStore.touch({ layerId: layer.id });
    return true;
  }

  flip(axis: "h" | "v"): void {
    if (axis === "h") this.params.sx = -this.params.sx;
    else this.params.sy = -this.params.sy;
  }

  cancel(): void {
    if (!this.active) return;
    const layer = this.layer;
    if (layer && this.original) {
      layer.raster = this.original;
      layer.offset = { ...this.originalOffset };
    }
    this.finish();
  }

  async commit(): Promise<void> {
    if (!this.active || this.busy) return;
    const layer = this.layer;
    const entry = this.entry;
    const floating = this.floating;
    const original = this.original;
    if (!layer || !entry || !floating || !original) {
      this.cancel();
      return;
    }
    if (isIdentityParams(this.params)) {
      this.cancel();
      return;
    }
    this.busy = true;
    try {
      const m = this.matrix;
      const bounds = this.bounds;
      if (layer.kind === "shape" || layer.kind === "text") {
        // Re-author the vector source instead of resampling its cached pixels.
        layer.raster = original;
        layer.offset = { ...this.originalOffset };
        const off = this.originalOffset;
        const org = this.origin;
        // layer-local → doc → floating-local → transformed doc → layer-local
        const map = (x: number, y: number): Point => {
          const q = Mat.apply(m, { x: x + off.x - org.x, y: y + off.y - org.y });
          return { x: q.x - off.x, y: q.y - off.y };
        };
        if (layer.kind === "shape") {
          const path: Path = clonePath(layer.path);
          for (const sp of path.subpaths) {
            for (const a of sp.anchors) {
              const p = map(a.x, a.y);
              const i = map(a.inX, a.inY);
              const o = map(a.outX, a.outY);
              a.x = p.x;
              a.y = p.y;
              a.inX = i.x;
              a.inY = i.y;
              a.outX = o.x;
              a.outY = o.y;
            }
          }
          docStore.exec(new SetShapeLayerCommand(layer.id, { path }, "Free Transform"));
        } else {
          if (this.params.angle % 360 !== 0) toast.info("Rotating type isn't supported yet — the text was scaled and moved. Rasterize the layer to rotate it.");
          const t = layer.text;
          const k = Math.max(0.01, (Math.abs(this.params.sx) + Math.abs(this.params.sy)) / 2);
          const p = map(t.x, t.y);
          // Keep the text centred where the box centre went.
          docStore.exec(new SetTextLayerCommand(layer.id, { x: p.x, y: p.y, size: Math.max(1, t.size * k), leading: t.leading === null ? null : t.leading * k }, "Free Transform"));
        }
        return;
      }
      const result = await affineResampleAsync(floating, m, bounds);
      // Restore the untouched layer before the command snapshots it.
      layer.raster = original;
      layer.offset = { ...this.originalOffset };

      let nextRaster: Raster;
      let nextOffset: Point;
      const cmds: Command[] = [];
      if (this.selection && this.working) {
        const layerRect = Rect.make(this.originalOffset.x, this.originalOffset.y, original.width, original.height);
        const union = Rect.union(layerRect, bounds);
        nextRaster = new Raster(union.w, union.h);
        nextRaster.blit(this.working, layerRect.x - union.x, layerRect.y - union.y, undefined, { mode: "replace" });
        nextRaster.blit(result, bounds.x - union.x, bounds.y - union.y);
        nextOffset = { x: union.x, y: union.y };
        cmds.push(new TransformLayerCommand(layer.id, nextRaster, nextOffset, "Free Transform"));
        // Carry the selection along with the pixels.
        const doc = rawDoc(entry);
        const selM = Mat.mul(m, Mat.translate(-this.origin.x, -this.origin.y));
        const lum = affineResampleAsync(this.selection.toLuminanceMask(), selM, Rect.ofSize(doc.width, doc.height));
        const lumR = await lum;
        const next = new Selection(doc.width, doc.height);
        const d = lumR.data;
        for (let i = 0, p = 0; i < next.mask.length; i++, p += 4) next.mask[i] = d[p + 3] === 0 ? 0 : d[p]!;
        cmds.push(new SetSelectionCommand(next, "Transform Selection"));
      } else {
        nextRaster = result;
        nextOffset = { x: bounds.x, y: bounds.y };
        cmds.push(new TransformLayerCommand(layer.id, nextRaster, nextOffset, "Free Transform"));
      }
      const cmd = cmds.length === 1 ? cmds[0]! : new CompositeCommand("Free Transform", cmds);
      docStore.exec(cmd);
    } finally {
      this.busy = false;
      this.finish(false);
    }
  }

  private finish(touch = true): void {
    const layerId = this.layerId;
    this.active = false;
    this.entry = null;
    this.layerId = null;
    this.floating = null;
    this.original = null;
    this.working = null;
    this.selection = null;
    this.params = { ...IDENTITY_PARAMS };
    this.floatingVersion++;
    if (touch && layerId) docStore.touch({ layerId });
  }
}

export const transformSession = new TransformSession();
