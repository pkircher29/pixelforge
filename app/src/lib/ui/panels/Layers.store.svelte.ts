/**
 * Layers / Channels / Paths panel UI state (not document state): multi-selection,
 * thumbnail options, expanded effect lists, the kind filter, mask targeting and solo
 * bookkeeping. Document-independent bits (thumbnail size, filter) persist to
 * localStorage; per-document bits are keyed by document id.
 */
import type { LayerId } from "$lib/engine";

const LS_KEY = "pixelforge.layers.v1";

export type ThumbSize = "none" | "small" | "medium" | "large";
export type ThumbContents = "bounds" | "document";
export type FilterMode = "kind" | "name" | "color";
export type KindFilter = "pixel" | "adjustment" | "type" | "shape" | "smart";

export const KIND_FILTERS: readonly { id: KindFilter; icon: string; title: string; disabled?: boolean }[] = [
  { id: "pixel", icon: "kind-pixel", title: "Filter for pixel layers" },
  { id: "adjustment", icon: "kind-adjust", title: "Filter for adjustment layers" },
  { id: "type", icon: "kind-type", title: "Filter for type layers" },
  { id: "shape", icon: "kind-shape", title: "Filter for shape layers" },
  { id: "smart", icon: "kind-smart", title: "Filter for smart objects", disabled: true },
];

interface Persisted {
  thumbSize: ThumbSize;
  thumbContents: ThumbContents;
  filterOn: boolean;
  filterMode: FilterMode;
  kinds: KindFilter[];
}

function load(): Partial<Persisted> {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

class LayersUiStore {
  /** Selected layer ids (multi-select). The document's `activeLayerId` is the "active" one. */
  selectedLayerIds = $state<LayerId[]>([]);
  /** Document the selection belongs to (reset on doc switch). */
  selectionDocId = $state<string | null>(null);
  /** Panel Options: thumbnail size (PS Medium default). */
  thumbSize = $state<ThumbSize>("medium");
  thumbContents = $state<ThumbContents>("document");
  /** Filter row. */
  filterOn = $state(true);
  filterMode = $state<FilterMode>("kind");
  kinds = $state<KindFilter[]>([]);
  nameFilter = $state("");
  colorFilter = $state<string | null>(null);
  /** Layers whose effects list is expanded under the row. */
  expandedEffects = $state<LayerId[]>([]);
  /** True while the active layer's mask thumbnail is the paint target (framed). */
  maskTargeted = $state(false);
  /** Inline-rename request from the Layer ▸ Rename Layer… command. */
  renameRequest = $state<LayerId | null>(null);
  /** Solo (Alt-click eye) bookkeeping: previous visibility per layer, per document. */
  solo = $state<{ docId: string; layerId: LayerId; prev: Record<LayerId, boolean> } | null>(null);
  /** Paths panel: the active path id (per document). */
  activePathId = $state<string | null>(null);
  /** Channels panel: ids of channels whose eye is on (R/G/B/alpha), per document. */
  hiddenChannels = $state<string[]>([]);

  constructor() {
    const p = load();
    if (p.thumbSize) this.thumbSize = p.thumbSize;
    if (p.thumbContents) this.thumbContents = p.thumbContents;
    if (typeof p.filterOn === "boolean") this.filterOn = p.filterOn;
    if (p.filterMode) this.filterMode = p.filterMode;
    if (Array.isArray(p.kinds)) this.kinds = p.kinds;
  }

  persist(): void {
    try {
      const data: Persisted = {
        thumbSize: this.thumbSize,
        thumbContents: this.thumbContents,
        filterOn: this.filterOn,
        filterMode: this.filterMode,
        kinds: $state.snapshot(this.kinds),
      };
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  /** Make sure the selection belongs to `docId`; drops it otherwise. */
  bind(docId: string | null): void {
    if (this.selectionDocId !== docId) {
      this.selectionDocId = docId;
      this.selectedLayerIds = [];
      this.expandedEffects = [];
      this.maskTargeted = false;
      this.activePathId = null;
      this.hiddenChannels = [];
    }
  }

  isSelected(id: LayerId, activeId: LayerId | null): boolean {
    return id === activeId || this.selectedLayerIds.includes(id);
  }

  setSelection(ids: LayerId[]): void {
    this.selectedLayerIds = [...new Set(ids)];
  }

  toggleKind(k: KindFilter): void {
    const i = this.kinds.indexOf(k);
    if (i >= 0) this.kinds.splice(i, 1);
    else this.kinds.push(k);
    this.persist();
  }

  setThumbSize(s: ThumbSize): void {
    this.thumbSize = s;
    this.persist();
  }

  setThumbContents(c: ThumbContents): void {
    this.thumbContents = c;
    this.persist();
  }

  setFilterOn(v: boolean): void {
    this.filterOn = v;
    this.persist();
  }

  setFilterMode(m: FilterMode): void {
    this.filterMode = m;
    this.persist();
  }

  toggleEffectsExpanded(id: LayerId): void {
    const i = this.expandedEffects.indexOf(id);
    if (i >= 0) this.expandedEffects.splice(i, 1);
    else this.expandedEffects.push(id);
  }
}

export const layersUi = new LayersUiStore();
