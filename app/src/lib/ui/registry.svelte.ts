/**
 * UI registry — the seam between the shell (menus, panels, command palette, shortcuts)
 * and feature modules (AI panel, adjustments, filters, tools).
 *
 * Feature modules call `registerPanel` / `registerCommand` at import time from their own
 * `register.ts`; the shell imports those files once in `App.svelte` and renders whatever
 * is registered. This keeps the waves decoupled.
 *
 * Contract is frozen — extend with optional fields only. v0.2 additions: `PanelDef.group`
 * (tab group), `PanelDef.menu` (≡ panel menu), string `icon` (glyph name from
 * `lib/ui/icons`), `CommandDef.checked` (menu check marks).
 */
import type { Component } from "svelte";

export type DockArea = "right" | "bottom" | "left";

/** Default tab groups of the "Essentials" workspace (PLAN-v2 §3). */
export type PanelGroupId = "color" | "properties" | "layers" | "history" | (string & {});

export interface PanelDef {
  /** Stable id, e.g. "layers", "ai", "ai-history", "history", "properties". */
  id: string;
  title: string;
  dock: DockArea;
  /** Lower renders first (order of tabs inside a group / of groups when unplaced). */
  order: number;
  component: Component;
  /**
   * Tab group this panel lives in by default: "color" (Color, Swatches), "properties",
   * "layers" (Layers, Channels, Paths), "history" (History, AI, AI History). Unknown ids
   * create a new group. Omitted → placed by the default workspace table, else its own group.
   */
  group?: PanelGroupId;
  /** Glyph name (`lib/ui/icons`) or a Lucide component — shown when the group is collapsed to icons. */
  icon?: Component | string;
  /** Commands listed in the panel's ≡ menu (top-right of the tab strip). */
  menu?: CommandDef[];
  /** Initially collapsed. */
  collapsed?: boolean;
  /** Preferred height in px when in a vertical dock. */
  preferredSize?: number;
}

export interface CommandDef {
  /** Stable id, e.g. "file.open", "image.adjust.levels", "ai.generate". */
  id: string;
  label: string;
  /**
   * Menu path using "/" separators, e.g. "Image/Adjustments". Omit for palette-only.
   * Top-level menus in order: File, Edit, Image, Layer, Type, Select, Filter, AI, View, Window, Help.
   */
  menu?: string;
  /** Position within its menu; lower first. Groups separated at every multiple of 100. */
  order?: number;
  /** Electron-style accelerator, e.g. "CmdOrCtrl+Shift+L", "F5". */
  shortcut?: string;
  /** Lucide icon for the palette. */
  icon?: Component;
  /** Shown in the palette as a hint; used for fuzzy search too. */
  keywords?: string[];
  enabled?: () => boolean;
  /** Toggle commands: a ✓ is drawn in menus when this returns true. */
  checked?: () => boolean;
  run: () => void | Promise<void>;
}

const panels = $state<PanelDef[]>([]);
const commands = $state<CommandDef[]>([]);

export function registerPanel(def: PanelDef): void {
  const i = panels.findIndex((p) => p.id === def.id);
  if (i >= 0) panels[i] = def;
  else panels.push(def);
}

export function registerCommand(def: CommandDef): void {
  const i = commands.findIndex((c) => c.id === def.id);
  if (i >= 0) commands[i] = def;
  else commands.push(def);
}

export function registerCommands(defs: CommandDef[]): void {
  for (const d of defs) registerCommand(d);
}

/** Reactive list of panels for a dock, sorted by `order`. */
export function getPanels(dock?: DockArea): PanelDef[] {
  return panels.filter((p) => !dock || p.dock === dock).sort((a, b) => a.order - b.order);
}

export function getPanel(id: string): PanelDef | undefined {
  return panels.find((p) => p.id === id);
}

/** Reactive list of all commands. */
export function getCommands(): CommandDef[] {
  return commands;
}

export function getCommand(id: string): CommandDef | undefined {
  return commands.find((c) => c.id === id);
}

/** Run a command by id if it exists and is enabled. Returns false if not run. */
export async function runCommand(id: string): Promise<boolean> {
  const c = getCommand(id);
  if (!c || (c.enabled && !c.enabled())) return false;
  await c.run();
  return true;
}
