/**
 * Shell UI state: workspace (tab groups, collapse, sizes), view toggles, dialog
 * bookkeeping, recent files. Persisted to localStorage (cheap, per-machine);
 * document-independent. Preferences that must survive machines live in `settings`.
 */

import type { ViewChannel } from "$lib/engine/types";

const LS_KEY = "pixelforge.ui.v2";
export const DEFAULT_DOCK_WIDTH = 280;

/** One tab group in the panel column. */
export interface PanelGroupLayout {
  id: string;
  /** Panel ids in tab order. */
  panels: string[];
  /** Active tab (panel id). */
  active: string;
  /** Collapsed to an icon row. */
  collapsed: boolean;
  /** Relative height weight (flex-grow) among expanded groups. */
  weight: number;
}

export interface Workspace {
  name: string;
  groups: PanelGroupLayout[];
  /** Whole column collapsed to an icon strip (PS ▸▸). */
  iconized: boolean;
}

/** Legacy per-panel layout (kept for `panel()` / `setPanel()` callers). */
export interface PanelLayout {
  weight: number;
  collapsed: boolean;
}

/** PLAN-v2 §3 "Essentials": the panel ids each group holds, in tab order. */
export const ESSENTIALS: readonly { id: string; panels: string[]; weight: number; collapsed?: boolean }[] = [
  { id: "color", panels: ["color", "swatches"], weight: 1 },
  // PS Essentials gives the Layers stack the height; Navigator/Info start collapsed.
  { id: "navigator", panels: ["navigator", "info"], weight: 0.9, collapsed: true },
  { id: "properties", panels: ["properties"], weight: 1.6 },
  { id: "layers", panels: ["layers", "channels", "paths"], weight: 3 },
  { id: "history", panels: ["history", "ai", "ai-history"], weight: 1.1 },
  { id: "brush", panels: ["brush-settings", "brushes"], weight: 1.2, collapsed: true },
  { id: "type", panels: ["character", "paragraph"], weight: 1, collapsed: true },
];

export function essentialsWorkspace(): Workspace {
  return {
    name: "Essentials",
    groups: ESSENTIALS.map((g) => ({ id: g.id, panels: g.panels.slice(), active: g.panels[0]!, collapsed: g.collapsed ?? false, weight: g.weight })),
    iconized: false,
  };
}

/** Default group for a panel id when the panel registers without `group`. */
export function defaultGroupFor(panelId: string): string | null {
  for (const g of ESSENTIALS) if (g.panels.includes(panelId)) return g.id;
  return null;
}

interface Persisted {
  dockWidth: number;
  workspace: Workspace;
  hiddenPanels: string[];
  showPixelGrid: boolean;
  showSelectionEdges: boolean;
  showRulers: boolean;
  toolbarFlyoutChoice: Record<string, string>;
  statusInfo: StatusInfoKind;
}

export type StatusInfoKind = "sizes" | "profile" | "dimensions" | "scratch" | "efficiency" | "timing" | "tool";

function load(): Partial<Persisted> {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function validWorkspace(w: unknown): w is Workspace {
  if (!w || typeof w !== "object") return false;
  const o = w as Workspace;
  return Array.isArray(o.groups) && o.groups.every((g) => g && typeof g.id === "string" && Array.isArray(g.panels) && typeof g.active === "string");
}

class UiStore {
  dockWidth = $state(DEFAULT_DOCK_WIDTH);
  workspace = $state<Workspace>(essentialsWorkspace());
  hiddenPanels = $state<string[]>([]);
  showPixelGrid = $state(true);
  showSelectionEdges = $state(true);
  showRulers = $state(false);
  /** Which tool a fly-out group currently shows (legacy; `toolStore.lastInGroup` is canonical). */
  toolbarFlyoutChoice = $state<Record<string, string>>({});
  /** Status bar info field (PS ▸ menu). */
  statusInfo = $state<StatusInfoKind>("sizes");

  /** Number of modal dialogs open (shortcuts are suspended while > 0). */
  modalDepth = $state(0);
  paletteOpen = $state(false);
  /** Text tool inline editor, rendered by CanvasView. */
  textEdit = $state<{ docX: number; docY: number; value: string } | null>(null);
  /** Last mouse position over the canvas in doc coords (status bar, rulers). */
  cursorDoc = $state<{ x: number; y: number } | null>(null);
  /** Recent file list mirrored from `io_recent_list`. */
  recentFiles = $state<string[]>([]);
  /** Last frame render time in ms (status bar "Timing"). */
  lastRenderMs = $state(0);
  /**
   * Channel view (Channels panel / Alt-click mask): `"rgb"` composite, `"r"|"g"|"b"`,
   * `"alpha:<id>"` or `"mask"` (the active layer's mask). Not persisted; reset to
   * `"rgb"` when the document changes. Owned by `layers-v2`, read by CanvasView.
   */
  viewChannel = $state<ViewChannel>("rgb");

  constructor() {
    const p = load();
    if (typeof p.dockWidth === "number") this.dockWidth = Math.max(200, Math.min(600, p.dockWidth));
    if (validWorkspace(p.workspace)) this.workspace = p.workspace;
    if (Array.isArray(p.hiddenPanels)) this.hiddenPanels = p.hiddenPanels;
    if (typeof p.showPixelGrid === "boolean") this.showPixelGrid = p.showPixelGrid;
    if (typeof p.showSelectionEdges === "boolean") this.showSelectionEdges = p.showSelectionEdges;
    if (typeof p.showRulers === "boolean") this.showRulers = p.showRulers;
    if (p.toolbarFlyoutChoice) this.toolbarFlyoutChoice = p.toolbarFlyoutChoice;
    if (typeof p.statusInfo === "string") this.statusInfo = p.statusInfo;
  }

  get modalOpen(): boolean {
    return this.modalDepth > 0;
  }

  persist(): void {
    try {
      const data: Persisted = {
        dockWidth: this.dockWidth,
        workspace: $state.snapshot(this.workspace),
        hiddenPanels: $state.snapshot(this.hiddenPanels),
        showPixelGrid: this.showPixelGrid,
        showSelectionEdges: this.showSelectionEdges,
        showRulers: this.showRulers,
        toolbarFlyoutChoice: $state.snapshot(this.toolbarFlyoutChoice),
        statusInfo: this.statusInfo,
      };
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* private mode / quota: layout just isn't remembered */
    }
  }

  // ---------------------------------------------------------------- workspace

  /** Group containing a panel, or null. */
  groupOf(panelId: string): PanelGroupLayout | null {
    return this.workspace.groups.find((g) => g.panels.includes(panelId)) ?? null;
  }

  /**
   * Make sure a registered panel has a home: its own `group` hint, the Essentials table,
   * else a new group named after it. Idempotent; call from an effect when panels register.
   */
  placePanel(panelId: string, groupHint?: string | null, weight = 1): void {
    if (this.groupOf(panelId)) return;
    const gid = groupHint ?? defaultGroupFor(panelId) ?? panelId;
    let g = this.workspace.groups.find((x) => x.id === gid);
    if (!g) {
      const ess = ESSENTIALS.find((e) => e.id === gid);
      g = { id: gid, panels: [], active: panelId, collapsed: ess?.collapsed ?? false, weight: ess?.weight ?? weight };
      this.workspace.groups.push(g);
    }
    g.panels.push(panelId);
    if (!g.panels.includes(g.active)) g.active = panelId;
    this.persist();
  }

  activateTab(panelId: string): void {
    const g = this.groupOf(panelId);
    if (!g) return;
    g.active = panelId;
    g.collapsed = false;
    const i = this.hiddenPanels.indexOf(panelId);
    if (i >= 0) this.hiddenPanels.splice(i, 1);
    this.persist();
  }

  setGroupCollapsed(groupId: string, collapsed: boolean): void {
    const g = this.workspace.groups.find((x) => x.id === groupId);
    if (!g) return;
    g.collapsed = collapsed;
    this.persist();
  }

  toggleGroupCollapsed(groupId: string): void {
    const g = this.workspace.groups.find((x) => x.id === groupId);
    if (g) this.setGroupCollapsed(groupId, !g.collapsed);
  }

  setIconized(v: boolean): void {
    this.workspace.iconized = v;
    this.persist();
  }

  /** Trade height between two adjacent expanded groups. `frac` is the top group's share of the pair. */
  setPairWeights(topId: string, bottomId: string, frac: number): void {
    const a = this.workspace.groups.find((x) => x.id === topId);
    const b = this.workspace.groups.find((x) => x.id === bottomId);
    if (!a || !b) return;
    const total = a.weight + b.weight;
    const f = Math.max(0.08, Math.min(0.92, frac));
    a.weight = f * total;
    b.weight = (1 - f) * total;
    this.persist();
  }

  /**
   * Move a panel tab into another group (or to a new group when `targetGroupId` is null),
   * at `index` within the target's tabs. Empty groups are removed.
   */
  movePanel(panelId: string, targetGroupId: string | null, index = Number.MAX_SAFE_INTEGER): void {
    const from = this.groupOf(panelId);
    if (!from) return;
    let target = targetGroupId ? this.workspace.groups.find((g) => g.id === targetGroupId) : undefined;
    if (targetGroupId && !target) return;
    if (from === target) {
      const cur = from.panels.indexOf(panelId);
      from.panels.splice(cur, 1);
      const at = Math.max(0, Math.min(from.panels.length, index > cur ? index - 1 : index));
      from.panels.splice(at, 0, panelId);
      from.active = panelId;
      this.persist();
      return;
    }
    from.panels.splice(from.panels.indexOf(panelId), 1);
    if (from.active === panelId) from.active = from.panels[0] ?? "";
    if (!target) {
      target = { id: `g-${panelId}-${Date.now().toString(36)}`, panels: [], active: panelId, collapsed: false, weight: Math.max(0.6, from.weight / 2) };
      from.weight = Math.max(0.6, from.weight / 2);
      this.workspace.groups.push(target);
    }
    target.panels.splice(Math.max(0, Math.min(target.panels.length, index)), 0, panelId);
    target.active = panelId;
    target.collapsed = false;
    this.workspace.groups = this.workspace.groups.filter((g) => g.panels.length > 0);
    this.persist();
  }

  /** Window ▸ Workspace ▸ Reset Essentials. */
  resetWorkspace(): void {
    this.workspace = essentialsWorkspace();
    this.hiddenPanels = [];
    this.dockWidth = DEFAULT_DOCK_WIDTH;
    this.persist();
  }

  // ---------------------------------------------------------------- legacy per-panel API

  /** Layout for a panel's group (pure read). */
  panel(id: string, defaults?: Partial<PanelLayout>): PanelLayout {
    const g = this.groupOf(id);
    if (g) return { weight: g.weight, collapsed: g.collapsed };
    return { weight: defaults?.weight ?? 1, collapsed: defaults?.collapsed ?? false };
  }

  /** Write a layout patch onto the panel's group (event handlers only). */
  setPanel(id: string, patch: Partial<PanelLayout>, defaults?: Partial<PanelLayout>): void {
    let g = this.groupOf(id);
    if (!g) {
      this.placePanel(id, null, defaults?.weight ?? 1);
      g = this.groupOf(id);
      if (!g) return;
      if (defaults?.collapsed !== undefined) g.collapsed = defaults.collapsed;
    }
    if (patch.weight !== undefined) g.weight = patch.weight;
    if (patch.collapsed !== undefined) g.collapsed = patch.collapsed;
    this.persist();
  }

  isPanelVisible(id: string): boolean {
    return !this.hiddenPanels.includes(id);
  }

  /** Window ▸ <panel>: hide when visible; otherwise show and bring its tab to front. */
  togglePanel(id: string): void {
    const i = this.hiddenPanels.indexOf(id);
    if (i >= 0) {
      this.hiddenPanels.splice(i, 1);
      const g = this.groupOf(id);
      if (g) {
        g.active = id;
        g.collapsed = false;
      }
    } else {
      this.hiddenPanels.push(id);
      const g = this.groupOf(id);
      if (g && g.active === id) g.active = g.panels.find((p) => p !== id && !this.hiddenPanels.includes(p)) ?? id;
    }
    this.persist();
  }

  resetLayout(): void {
    this.resetWorkspace();
    this.toolbarFlyoutChoice = {};
    this.persist();
  }

  setDockWidth(w: number): void {
    this.dockWidth = Math.max(200, Math.min(600, Math.round(w)));
    this.persist();
  }

  setFlyoutChoice(group: string, toolId: string): void {
    this.toolbarFlyoutChoice[group] = toolId;
    this.persist();
  }

  toggleRulers(): void {
    this.showRulers = !this.showRulers;
    this.persist();
  }

  setStatusInfo(kind: StatusInfoKind): void {
    this.statusInfo = kind;
    this.persist();
  }
}

export const ui = new UiStore();
