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
  TransformLayerCommand,
  type Command,
  type Point,
  type RasterLayer,
} from "$lib/engine";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { rawDoc, rawRasterLayer } from "../raw";
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

  /** The raw (non-proxied) layer being transformed. */
  get layer(): RasterLayer | null {
    if (!this.entry || !this.layerId) return null;
    return rawRasterLayer(this.entry, this.layerId);
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

  /** Start a session on the active raster layer. Returns false (and does nothing) if impossible. */
  begin(): boolean {
    if (this.active) return true;
    const entry = docStore.active;
    const active = docStore.activeLayer;
    if (!entry || !active || active.kind !== "raster") return false;
    // Mutate the raw objects only (see raw.ts).
    const doc = rawDoc(entry);
    const layer = rawRasterLayer(entry, active.id);
    if (!layer || layer.locked) return false;
    const sel = doc.selection;
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
      this.floating = layer.raster;
      this.origin = { ...layer.offset };
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
