/**
 * Per-layer dirty-rect bookkeeping shared by both compositors. Rects are in the
 * layer's own raster space. A `null` rect means "the whole layer".
 */

import { Rect } from "../rect";
import type { LayerId } from "../types";

export class DirtyTracker {
  private readonly map = new Map<LayerId, Rect | null>();

  /** Mark `rect` (or the whole layer) dirty; rects accumulate as a union. */
  mark(layerId: LayerId, rect?: Rect): void {
    if (!rect) {
      this.map.set(layerId, null);
      return;
    }
    if (Rect.isEmpty(rect)) return;
    if (!this.map.has(layerId)) {
      this.map.set(layerId, { ...rect });
      return;
    }
    const cur = this.map.get(layerId);
    if (cur === null) return; // already whole-layer
    this.map.set(layerId, Rect.union(cur ?? null, rect));
  }

  has(layerId: LayerId): boolean {
    return this.map.has(layerId);
  }

  /**
   * Remove and return the dirty region: `"full"`, a rect, or `undefined` when clean.
   */
  take(layerId: LayerId): Rect | "full" | undefined {
    if (!this.map.has(layerId)) return undefined;
    const r = this.map.get(layerId);
    this.map.delete(layerId);
    return r === null ? "full" : r;
  }

  /** Peek without clearing. */
  peek(layerId: LayerId): Rect | "full" | undefined {
    if (!this.map.has(layerId)) return undefined;
    const r = this.map.get(layerId);
    return r === null ? "full" : r;
  }

  get size(): number {
    return this.map.size;
  }

  get isEmpty(): boolean {
    return this.map.size === 0;
  }

  layerIds(): LayerId[] {
    return [...this.map.keys()];
  }

  clear(): void {
    this.map.clear();
  }

  /** Drop entries for layers that no longer exist. */
  retain(ids: ReadonlySet<LayerId>): void {
    for (const id of this.map.keys()) if (!ids.has(id)) this.map.delete(id);
  }
}

/** The lowest index in `order` whose id appears in `ids`, or `-1`. */
export function lowestIndexOf(order: readonly LayerId[], ids: Iterable<LayerId>): number {
  const set = new Set(ids);
  for (let i = 0; i < order.length; i++) if (set.has(order[i]!)) return i;
  return -1;
}
