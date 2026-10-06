/**
 * Drag-reorder math for the Layers panel (pure). The panel shows layers top-to-bottom
 * (engine order reversed); `MoveLayerToCommand` / `ReorderLayerCommand` want the index
 * *after removal* of the moved block.
 */
import { layerBlock, findLayer, type Document, type LayerId } from "$lib/engine";

/**
 * @param from   engine index of the dragged layer (before removal)
 * @param target engine index of the row it was dropped on
 * @param above  true when dropped on the upper half of the row (i.e. should end up
 *               *above* it in the panel = higher engine index)
 * @param blockLen length of the dragged block (1 for plain layers; group + children)
 */
export function reorderTarget(from: number, target: number, above: boolean, blockLen = 1): number {
  if (target === from) return from;
  // Desired final index of the block start in the array *without* the block.
  let final = above ? target + 1 : target;
  if (from < target) final -= blockLen;
  return Math.max(0, final);
}

/** Geometry of one rendered layer row (panel order, top to bottom). */
export interface RowGeom {
  id: LayerId;
  top: number;
  height: number;
  isGroup: boolean;
  /** Group is expanded (children rendered below it). */
  expanded: boolean;
  parentId: LayerId | null;
}

export type DropPos = "above" | "below" | "into";

export interface DropTarget {
  id: LayerId;
  pos: DropPos;
}

/**
 * Where a drag at `y` (same coordinate space as the rows) would drop. Upper third of a
 * row → above it, lower third → below it; the middle third of a group row → into the
 * group. Rows belonging to the dragged block are never targets. Below the last row →
 * below it; above the first → above it.
 */
export function computeDrop(rows: readonly RowGeom[], y: number, draggedId: LayerId, draggedChildren: readonly LayerId[] = [], draggedIsGroup = false): DropTarget | null {
  const skip = new Set([draggedId, ...draggedChildren]);
  const candidates = rows.filter((r) => !skip.has(r.id));
  if (candidates.length === 0) return null;
  const first = candidates[0]!;
  if (y < first.top) return { id: first.id, pos: "above" };
  const last = candidates[candidates.length - 1]!;
  if (y >= last.top + last.height) return { id: last.id, pos: "below" };
  for (const r of candidates) {
    if (y < r.top || y >= r.top + r.height) continue;
    const f = (y - r.top) / r.height;
    if (r.isGroup && !draggedIsGroup && f >= 1 / 3 && f < 2 / 3) return { id: r.id, pos: "into" };
    return { id: r.id, pos: f < 0.5 ? "above" : "below" };
  }
  // In a gap (over the dragged block's own rows): snap to the nearest candidate edge.
  let best: RowGeom | null = null;
  let bestD = Infinity;
  for (const r of candidates) {
    const d = Math.min(Math.abs(y - r.top), Math.abs(y - (r.top + r.height)));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best ? { id: best.id, pos: y < best.top + best.height / 2 ? "above" : "below" } : null;
}

export interface ResolvedDrop {
  /** Index after removal of the dragged block. */
  toIndex: number;
  parentId: LayerId | null;
}

/**
 * Translate a drop target into a `MoveLayerToCommand` destination. "Above row R" in
 * the panel means directly after R's block in engine order; "below R" means before it
 * (and, when R is an expanded group, at the top *inside* it, like Photoshop). Groups
 * can't nest, so a dragged group always lands at top level.
 */
export function resolveDrop(doc: Document, draggedId: LayerId, target: DropTarget): ResolvedDrop | null {
  const dragged = findLayer(doc, draggedId);
  const row = findLayer(doc, target.id);
  if (!dragged || !row || dragged.id === row.id) return null;
  if (row.parentId === draggedId) return null; // can't drop a group into itself
  const from = layerBlock(doc, draggedId);
  const blockLen = from.end - from.start;
  // A dragged group dropped next to a child lands beside the child's whole group.
  const anchor = dragged.kind === "group" && row.parentId ? findLayer(doc, row.parentId)! : row;
  const rb = layerBlock(doc, anchor.id);
  if (anchor !== row) {
    const rawIndex = target.pos === "above" ? rb.end : rb.start;
    return { toIndex: Math.max(0, from.start < rawIndex ? rawIndex - blockLen : rawIndex), parentId: null };
  }
  let rawIndex: number;
  let parentId: LayerId | null;
  if (target.pos === "into") {
    if (row.kind !== "group") return null;
    rawIndex = rb.end;
    parentId = row.id;
  } else if (target.pos === "above") {
    rawIndex = rb.end;
    parentId = row.parentId;
  } else if (row.kind === "group" && !row.collapsed && dragged.kind !== "group") {
    rawIndex = rb.end;
    parentId = row.id;
  } else {
    rawIndex = rb.start;
    parentId = row.parentId;
  }
  if (dragged.kind === "group") parentId = null;
  let toIndex = rawIndex;
  if (from.start < rawIndex) toIndex -= blockLen;
  return { toIndex: Math.max(0, toIndex), parentId };
}
