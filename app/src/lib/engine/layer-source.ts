/**
 * Per-layer *source* pixels for compositing, shared by the CPU and GL compositors:
 *
 * - raster / shape / text → the layer's (cached) raster
 * - fill → the fill rendered at document size (cached per fill spec + size)
 * - adjustment / group → no source (handled by the compositors)
 *
 * `StyleCache` memoises the expensive derived rasters (masked source + layer effects via
 * `renderLayerStyle`, and the clip alpha of clipping-mask bases). Compositors own one
 * and call `invalidate(layerId)` from `markDirty`; identity changes of the raster /
 * mask / effects / fill objects and value changes of the scalar inputs are detected
 * automatically through the cache key.
 */

import { Rect, type Point } from "./rect";
import { Raster } from "./raster";
import type { Document, FillLayer, Layer, LayerId } from "./types";
import { applyMaskToRaster, effectExtent, hasEnabledEffects, renderLayerStyle } from "./ops/effects";
import { renderFill } from "./ops/fill";

/** Pixel layers carry their own raster; fill layers render one on demand. */
export function layerHasPixels(layer: Layer): boolean {
  return layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text";
}

/** The layer's raster (own or cached), or null for groups / adjustments / fills. */
export function layerRaster(layer: Layer): Raster | null {
  return layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text" ? layer.raster : null;
}

const fillCache = new WeakMap<FillLayer, { spec: FillLayer["fill"]; w: number; h: number; raster: Raster; pattern: Raster | null }>();

/** Document-sized rendering of a fill layer (memoised on the fill spec identity + size). */
export function fillLayerRaster(layer: FillLayer, w: number, h: number): Raster {
  const c = fillCache.get(layer);
  const pattern = layer.fill.type === "pattern" ? layer.fill.pattern : null;
  if (c && c.spec === layer.fill && c.w === w && c.h === h && c.pattern === pattern) return c.raster;
  const raster = renderFill(layer.fill, w, h);
  fillCache.set(layer, { spec: layer.fill, w, h, raster, pattern });
  return raster;
}

/** Drop a fill layer's cached rendering (after mutating its spec in place). */
export function invalidateFillLayer(layer: FillLayer): void {
  fillCache.delete(layer);
}

export interface LayerSource {
  raster: Raster;
  /** Document-space position of `raster`'s origin. */
  offset: Point;
}

/** Unstyled, unmasked source pixels of a layer, or null when it has none. */
export function layerSource(doc: Document, layer: Layer): LayerSource | null {
  switch (layer.kind) {
    case "raster":
    case "shape":
    case "text":
      return { raster: layer.raster, offset: layer.offset };
    case "fill":
      return { raster: fillLayerRaster(layer, doc.width, doc.height), offset: layer.offset };
    default:
      return null;
  }
}

/** True when the mask should be applied. */
export function maskActive(layer: Layer): boolean {
  return !!layer.mask && layer.maskEnabled;
}

export interface StyledSource extends LayerSource {
  /** True when `raster` already includes the mask and effects (blend without them). */
  styled: boolean;
  /** Extent the effects added on every side (0 when unstyled). */
  extent: number;
}

interface StyleEntry {
  key: string;
  raster: Raster;
  offset: Point;
  extent: number;
  styled: boolean;
}

interface ClipEntry {
  key: string;
  alpha: Uint8Array;
}

function styleKey(doc: Document, layer: Layer, src: LayerSource): string {
  // Object identities become stable tokens via a per-cache registry.
  return `${doc.width}x${doc.height}|${layer.fillOpacity}|${layer.maskEnabled ? 1 : 0}|${src.offset.x},${src.offset.y}`;
}

/**
 * Memo of styled sources and clip alphas. One per compositor. Also usable standalone
 * (`new StyleCache()`) for exports; `compositeToRaster` creates a throwaway one when
 * none is passed.
 */
export class StyleCache {
  private readonly styles = new Map<LayerId, StyleEntry>();
  private readonly clips = new Map<LayerId, ClipEntry>();
  private readonly ids = new WeakMap<object, number>();
  private nextId = 1;

  private token(o: object | null): number {
    if (!o) return 0;
    let t = this.ids.get(o);
    if (t === undefined) {
      t = this.nextId++;
      this.ids.set(o, t);
    }
    return t;
  }

  /** Forget derived data for a layer (its pixels or mask changed in place). */
  invalidate(layerId: LayerId): void {
    this.styles.delete(layerId);
    this.clips.delete(layerId);
  }

  clear(): void {
    this.styles.clear();
    this.clips.clear();
  }

  /** Drop entries for layers that no longer exist. */
  retain(ids: ReadonlySet<LayerId>): void {
    for (const id of this.styles.keys()) if (!ids.has(id)) this.styles.delete(id);
    for (const id of this.clips.keys()) if (!ids.has(id)) this.clips.delete(id);
  }

  /**
   * The layer's source with mask and effects applied when it has effects (`styled`
   * true), otherwise the raw source (the compositor applies mask / fill opacity itself).
   */
  styledSource(doc: Document, layer: Layer): StyledSource | null {
    const src = layerSource(doc, layer);
    if (!src) return null;
    if (!hasEnabledEffects(layer.effects)) return { ...src, styled: false, extent: 0 };
    const key = `${styleKey(doc, layer, src)}|${this.token(src.raster)}|${this.token(layer.mask)}|${this.token(layer.effects)}|${JSON.stringify(layer.effects)}`;
    const hit = this.styles.get(layer.id);
    if (hit && hit.key === key) return { raster: hit.raster, offset: hit.offset, styled: true, extent: hit.extent };
    const masked = maskActive(layer) ? applyMaskToRaster(src.raster, layer.mask!) : src.raster;
    const styled = renderLayerStyle(masked, layer.effects!, layer.fillOpacity);
    const entry: StyleEntry = {
      key,
      raster: styled.raster,
      offset: { x: src.offset.x + styled.dx, y: src.offset.y + styled.dy },
      extent: styled.extent,
      styled: true,
    };
    this.styles.set(layer.id, entry);
    return { raster: entry.raster, offset: entry.offset, styled: true, extent: entry.extent };
  }

  /**
   * Document-sized alpha (0..255) of a clipping-mask base: its masked source alpha
   * without effects, opacity or fill opacity (Photoshop clips to the base's content).
   * Adjustment-layer bases clip to "everything" (all 255).
   */
  clipAlpha(doc: Document, base: Layer): Uint8Array {
    const src = layerSource(doc, base);
    const key = `${doc.width}x${doc.height}|${this.token(src?.raster ?? null)}|${this.token(base.mask)}|${base.maskEnabled ? 1 : 0}|${base.offset.x},${base.offset.y}`;
    const hit = this.clips.get(base.id);
    if (hit && hit.key === key) return hit.alpha;
    const alpha = new Uint8Array(doc.width * doc.height);
    if (!src) {
      alpha.fill(255);
    } else {
      const r = src.raster;
      const m = maskActive(base) ? base.mask : null;
      const area = Rect.intersect(Rect.make(src.offset.x, src.offset.y, r.width, r.height), Rect.ofSize(doc.width, doc.height));
      for (let y = area.y; y < area.y + area.h; y++) {
        for (let x = area.x; x < area.x + area.w; x++) {
          const lx = x - src.offset.x;
          const ly = y - src.offset.y;
          let a = r.data[(ly * r.width + lx) * 4 + 3]!;
          if (m) {
            const mv = lx < m.width && ly < m.height ? m.data[(ly * m.width + lx) * 4]! : 255;
            a = (a * mv) / 255;
          }
          alpha[y * doc.width + x] = a;
        }
      }
    }
    this.clips.set(base.id, { key, alpha });
    return alpha;
  }
}

/**
 * Per-document shared style cache. The live compositor binds its own (which it keeps
 * coherent through `markDirty`), so CPU composites of the same document — Info panel
 * readouts, eyedropper, wand, Navigator fallback, AI inputs — reuse the rendered layer
 * styles instead of re-rendering every effect (seconds on a styled document).
 */
const docCaches = new WeakMap<Document, StyleCache>();

/** Bind `cache` as the shared style cache of `doc` (compositors call this on render). */
export function bindDocStyleCache(doc: Document, cache: StyleCache): void {
  if (docCaches.get(doc) !== cache) docCaches.set(doc, cache);
}

/** The shared style cache bound to `doc`, if a compositor is rendering it. */
export function docStyleCache(doc: Document): StyleCache | undefined {
  return docCaches.get(doc);
}

/** Document-space rect a layer can touch, including its effect extent. */
export function layerVisualRect(doc: Document, layer: Layer): Rect {
  const src = layerSource(doc, layer);
  const base = src ? Rect.make(src.offset.x, src.offset.y, src.raster.width, src.raster.height) : Rect.ofSize(doc.width, doc.height);
  const ext = effectExtent(layer.effects);
  return ext > 0 ? Rect.inflate(base, ext) : base;
}
