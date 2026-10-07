/**
 * Swatches panel store: the flat "Default" grid plus collapsible groups (PS CC 2020+),
 * thumbnail size and search, persisted in app settings under `swatches`. Pure
 * (de)serialisation helpers are exported for import / export and tests. ASE / ACO
 * files are not supported — only Pixelforge's own `.json` set.
 */
import { settings } from "$lib/stores/settings.svelte";
import { hexToRgb, rgbToHex, type RGB } from "./color-model";
import { defaultGroups, defaultSwatches } from "./swatch-defaults";

export interface Swatch {
  id: string;
  name: string;
  color: RGB;
}

export interface SwatchGroup {
  id: string;
  name: string;
  collapsed: boolean;
  swatches: Swatch[];
}

export type SwatchThumb = "small" | "large";

export interface SwatchSet {
  items: Swatch[];
  groups: SwatchGroup[];
}

/** Persisted / exported shape (`c` is `#rrggbb`). */
export interface SwatchSetJson {
  "pixelforge-swatches": 1;
  items: { n: string; c: string }[];
  groups: { n: string; collapsed?: boolean; items: { n: string; c: string }[] }[];
}

export const SWATCHES_SETTINGS_KEY = "swatches";

let seq = 0;
export function swatchId(): string {
  return `sw_${(++seq).toString(36)}_${Date.now().toString(36)}`;
}

export function serializeSwatches(set: SwatchSet): SwatchSetJson {
  const item = (s: Swatch): { n: string; c: string } => ({ n: s.name, c: rgbToHex(s.color) });
  return {
    "pixelforge-swatches": 1,
    items: set.items.map(item),
    groups: set.groups.map((g) => ({ n: g.name, collapsed: g.collapsed, items: g.swatches.map(item) })),
  };
}

/** Parse a set; tolerant of missing fields, rejects anything that is not a swatch file. */
export function parseSwatches(raw: unknown): SwatchSet | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<SwatchSetJson>;
  if (!Array.isArray(o.items) && !Array.isArray(o.groups)) return null;
  const item = (x: unknown): Swatch | null => {
    if (!x || typeof x !== "object") return null;
    const e = x as { n?: unknown; c?: unknown };
    const color = typeof e.c === "string" ? hexToRgb(e.c) : null;
    if (!color) return null;
    return { id: swatchId(), name: typeof e.n === "string" ? e.n : rgbToHex(color), color };
  };
  const items = (Array.isArray(o.items) ? o.items : []).map(item).filter((s): s is Swatch => s !== null);
  const groups = (Array.isArray(o.groups) ? o.groups : [])
    .map((g): SwatchGroup | null => {
      if (!g || typeof g !== "object") return null;
      const e = g as { n?: unknown; collapsed?: unknown; items?: unknown };
      return {
        id: swatchId(),
        name: typeof e.n === "string" ? e.n : "Group",
        collapsed: e.collapsed === true,
        swatches: (Array.isArray(e.items) ? e.items : []).map(item).filter((s): s is Swatch => s !== null),
      };
    })
    .filter((g): g is SwatchGroup => g !== null);
  return { items, groups };
}

export function defaultSwatchSet(): SwatchSet {
  return {
    items: defaultSwatches().map((s) => ({ id: swatchId(), name: s.name, color: s.color })),
    groups: defaultGroups().map((g) => ({ id: swatchId(), name: g.name, collapsed: true, swatches: g.swatches.map((s) => ({ id: swatchId(), name: s.name, color: s.color })) })),
  };
}

/** Case-insensitive name / hex filter. */
export function filterSwatches(list: readonly Swatch[], query: string): Swatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((s) => s.name.toLowerCase().includes(q) || rgbToHex(s.color).includes(q.replace(/^#/, "")));
}

class SwatchStore {
  items = $state<Swatch[]>([]);
  groups = $state<SwatchGroup[]>([]);
  thumb = $state<SwatchThumb>("small");
  query = $state("");
  private hydrated = false;

  constructor() {
    const d = defaultSwatchSet();
    this.items = d.items;
    this.groups = d.groups;
  }

  /** Load the persisted set once settings are available (idempotent). */
  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const raw = settings.value[SWATCHES_SETTINGS_KEY] as { set?: unknown; thumb?: unknown } | undefined;
    if (!raw || typeof raw !== "object") return;
    const set = parseSwatches(raw.set);
    if (set) {
      this.items = set.items;
      this.groups = set.groups;
    }
    if (raw.thumb === "small" || raw.thumb === "large") this.thumb = raw.thumb;
  }

  persist(): void {
    void settings.set({ [SWATCHES_SETTINGS_KEY]: { set: serializeSwatches({ items: $state.snapshot(this.items), groups: $state.snapshot(this.groups) }), thumb: this.thumb } });
  }

  get set(): SwatchSet {
    return { items: this.items, groups: this.groups };
  }

  /** Every swatch, grouped or not. */
  get all(): Swatch[] {
    return [...this.items, ...this.groups.flatMap((g) => g.swatches)];
  }

  add(color: RGB, name?: string, groupId?: string | null): Swatch {
    const s: Swatch = { id: swatchId(), name: name ?? rgbToHex(color).toUpperCase().replace("#", "Swatch "), color: { ...color } };
    const g = groupId ? this.groups.find((x) => x.id === groupId) : null;
    if (g) g.swatches.push(s);
    else this.items.push(s);
    this.persist();
    return s;
  }

  remove(id: string): boolean {
    const i = this.items.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.items.splice(i, 1);
      this.persist();
      return true;
    }
    for (const g of this.groups) {
      const j = g.swatches.findIndex((s) => s.id === id);
      if (j >= 0) {
        g.swatches.splice(j, 1);
        this.persist();
        return true;
      }
    }
    return false;
  }

  rename(id: string, name: string): void {
    const s = this.all.find((x) => x.id === id);
    if (!s) return;
    s.name = name;
    this.persist();
  }

  addGroup(name: string): SwatchGroup {
    const g: SwatchGroup = { id: swatchId(), name, collapsed: false, swatches: [] };
    this.groups.push(g);
    this.persist();
    return g;
  }

  removeGroup(id: string): void {
    this.groups = this.groups.filter((g) => g.id !== id);
    this.persist();
  }

  toggleGroup(id: string): void {
    const g = this.groups.find((x) => x.id === id);
    if (!g) return;
    g.collapsed = !g.collapsed;
    this.persist();
  }

  setThumb(t: SwatchThumb): void {
    this.thumb = t;
    this.persist();
  }

  /** Replace everything with an imported set (or append when `append`). */
  importSet(set: SwatchSet, append = false): void {
    if (append) {
      this.items.push(...set.items);
      this.groups.push(...set.groups);
    } else {
      this.items = set.items;
      this.groups = set.groups;
    }
    this.persist();
  }

  resetToDefault(): void {
    const d = defaultSwatchSet();
    this.items = d.items;
    this.groups = d.groups;
    this.persist();
  }

  exportJson(): string {
    return JSON.stringify(serializeSwatches(this.set), null, 2);
  }
}

export const swatchStore = new SwatchStore();
