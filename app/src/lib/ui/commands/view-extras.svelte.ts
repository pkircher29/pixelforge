/**
 * View ▸ Extras / Show ▸ / Snap state that the shell store doesn't carry: the Extras
 * master switch (Ctrl+H hides every extra without forgetting which ones were on), Layer
 * Edges, Grid (PS default: a line every 100 px, 4 subdivisions) and Snap. Persisted per
 * machine. Grid and Layer Edges are drawn by `ViewExtrasOverlay.svelte`.
 */
import { ui } from "$lib/stores/ui.svelte";

const LS_KEY = "pixelforge.viewextras.v1";

interface Persisted {
  extras: boolean;
  layerEdges: boolean;
  grid: boolean;
  snap: boolean;
  gridEvery: number;
  gridSubdivisions: number;
}

class ViewExtras {
  extras = $state(true);
  layerEdges = $state(false);
  grid = $state(false);
  snap = $state(true);
  gridEvery = $state(100);
  gridSubdivisions = $state(4);
  /** Selection edges / pixel grid as they were when Extras was switched off. */
  private saved: { selectionEdges: boolean; pixelGrid: boolean } | null = null;

  constructor() {
    try {
      const raw = globalThis.localStorage?.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persisted>;
        if (typeof p.extras === "boolean") this.extras = p.extras;
        if (typeof p.layerEdges === "boolean") this.layerEdges = p.layerEdges;
        if (typeof p.grid === "boolean") this.grid = p.grid;
        if (typeof p.snap === "boolean") this.snap = p.snap;
        if (typeof p.gridEvery === "number" && p.gridEvery > 0) this.gridEvery = p.gridEvery;
        if (typeof p.gridSubdivisions === "number" && p.gridSubdivisions > 0) this.gridSubdivisions = p.gridSubdivisions;
      }
    } catch {
      /* ignore */
    }
  }

  persist(): void {
    try {
      const d: Persisted = { extras: this.extras, layerEdges: this.layerEdges, grid: this.grid, snap: this.snap, gridEvery: this.gridEvery, gridSubdivisions: this.gridSubdivisions };
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }

  /** Is an individual extra actually drawn right now? */
  visible(kind: "layerEdges" | "grid"): boolean {
    return this.extras && this[kind];
  }

  /** Ctrl+H: hide / show every extra, remembering the individual switches. */
  toggleExtras(): void {
    if (this.extras) {
      this.saved = { selectionEdges: ui.showSelectionEdges, pixelGrid: ui.showPixelGrid };
      ui.showSelectionEdges = false;
      ui.showPixelGrid = false;
      this.extras = false;
    } else {
      const s = this.saved ?? { selectionEdges: true, pixelGrid: ui.showPixelGrid };
      ui.showSelectionEdges = s.selectionEdges;
      ui.showPixelGrid = s.pixelGrid;
      this.saved = null;
      this.extras = true;
    }
    ui.persist();
    this.persist();
  }

  /** Turning an individual extra on also turns Extras back on (PS). */
  toggle(kind: "layerEdges" | "grid" | "snap"): void {
    this[kind] = !this[kind];
    if (kind !== "snap" && this[kind] && !this.extras) {
      this.extras = true;
      this.saved = null;
    }
    this.persist();
  }
}

export const viewExtras = new ViewExtras();
