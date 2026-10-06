/**
 * UI registry — the seam between the shell (menus, panels, command palette, shortcuts)
 * and feature modules (AI panel, adjustments, filters, tools).
 *
 * Feature modules call `registerPanel` / `registerCommand` at import time from their own
 * `register.ts`; the shell imports those files once in `App.svelte` and renders whatever
 * is registered. This keeps `ui-shell-tools`, `ai-panel`, and `adjust-filters` decoupled.
 *
 * Contract is frozen for Wave 3 — extend with optional fields only.
 */
import type { Component } from "svelte";

export type DockArea = "right" | "bottom" | "left";

export interface PanelDef {
  /** Stable id, e.g. "layers", "ai", "ai-history", "history", "properties". */
  id: string;
  title: string;
  dock: DockArea;
  /** Lower renders first (top of the dock). */
  order: number;
  component: Component;
  /** Lucide icon component for the dock tab strip. */
  icon?: Component;
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
   * Top-level menus in order: File, Edit, Image, Layer, Select, Filter, AI, View, Window, Help.
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
