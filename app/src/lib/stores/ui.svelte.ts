/**
 * Shell UI state: dock/panel layout, view toggles, dialog bookkeeping, recent files.
 * Persisted to localStorage (cheap, per-machine); document-independent.
 */

const LS_KEY = "pixelforge.ui.v1";

export interface PanelLayout {
  /** Relative weight inside the dock (flex-grow). */
  weight: number;
  collapsed: boolean;
}

interface Persisted {
  dockWidth: number;
  panels: Record<string, PanelLayout>;
  hiddenPanels: string[];
  showPixelGrid: boolean;
  showSelectionEdges: boolean;
  toolbarFlyoutChoice: Record<string, string>;
}

function load(): Partial<Persisted> {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

class UiStore {
  dockWidth = $state(288);
  panels = $state<Record<string, PanelLayout>>({});
  hiddenPanels = $state<string[]>([]);
  showPixelGrid = $state(true);
  showSelectionEdges = $state(true);
  /** Which tool a fly-out group currently shows (e.g. marquee -> "marquee-ellipse"). */
  toolbarFlyoutChoice = $state<Record<string, string>>({});

  /** Number of modal dialogs open (shortcuts are suspended while > 0). */
  modalDepth = $state(0);
  paletteOpen = $state(false);
  /** Text tool inline editor, rendered by CanvasView. */
  textEdit = $state<{ docX: number; docY: number; value: string } | null>(null);
  /** Last mouse position over the canvas in doc coords (status bar). */
  cursorDoc = $state<{ x: number; y: number } | null>(null);
  /** Recent file list mirrored from `io_recent_list`. */
  recentFiles = $state<string[]>([]);

  constructor() {
    const p = load();
    if (typeof p.dockWidth === "number") this.dockWidth = Math.max(200, Math.min(600, p.dockWidth));
    if (p.panels) this.panels = p.panels;
    if (Array.isArray(p.hiddenPanels)) this.hiddenPanels = p.hiddenPanels;
    if (typeof p.showPixelGrid === "boolean") this.showPixelGrid = p.showPixelGrid;
    if (typeof p.showSelectionEdges === "boolean") this.showSelectionEdges = p.showSelectionEdges;
    if (p.toolbarFlyoutChoice) this.toolbarFlyoutChoice = p.toolbarFlyoutChoice;
  }

  get modalOpen(): boolean {
    return this.modalDepth > 0;
  }

  persist(): void {
    try {
      const data: Persisted = {
        dockWidth: this.dockWidth,
        panels: $state.snapshot(this.panels),
        hiddenPanels: $state.snapshot(this.hiddenPanels),
        showPixelGrid: this.showPixelGrid,
        showSelectionEdges: this.showSelectionEdges,
        toolbarFlyoutChoice: $state.snapshot(this.toolbarFlyoutChoice),
      };
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* private mode / quota: layout just isn't remembered */
    }
  }

  /**
   * Layout for a panel. Pure read (safe inside templates/deriveds): when nothing is
   * stored yet the defaults are returned without being written.
   */
  panel(id: string, defaults?: Partial<PanelLayout>): PanelLayout {
    const p = this.panels[id];
    if (p) return p;
    return { weight: defaults?.weight ?? 1, collapsed: defaults?.collapsed ?? false };
  }

  /** Write a layout patch (event handlers only). `defaults` seed a first-time entry. */
  setPanel(id: string, patch: Partial<PanelLayout>, defaults?: Partial<PanelLayout>): void {
    this.panels[id] = { ...this.panel(id, defaults), ...patch };
    this.persist();
  }

  isPanelVisible(id: string): boolean {
    return !this.hiddenPanels.includes(id);
  }

  togglePanel(id: string): void {
    const i = this.hiddenPanels.indexOf(id);
    if (i >= 0) this.hiddenPanels.splice(i, 1);
    else this.hiddenPanels.push(id);
    this.persist();
  }

  resetLayout(): void {
    this.dockWidth = 288;
    this.panels = {};
    this.hiddenPanels = [];
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
}

export const ui = new UiStore();
