/**
 * Image (canvas flips/rotates), View, Window and Help menus.
 *
 * View follows Photoshop: Zoom In / Zoom Out / Fit on Screen / 100% / 200% / Print Size │
 * Screen Mode ▸ │ Extras (Ctrl+H) / Show ▸ (Selection Edges, Layer Edges, Pixel Grid,
 * Grid) │ Rulers (Ctrl+R) │ Snap. Proof Setup, Guides and Lock Guides are not
 * implemented. `registerViewMenu()` is called again from `panels/register.ts` (which
 * loads after `shell-commands.ts`) so these definitions replace the shell's v0.1 ones.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clampZoom } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { toolStore, type ScreenMode } from "$lib/stores/tool.svelte";
import { registerCommand, registerCommands, getPanels, type CommandDef } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import AboutDialog from "../dialogs/AboutDialog.svelte";
import { canvasHost } from "../canvas/host.svelte";
import { FlipCanvasCommand, RotateCanvasCommand } from "./canvas-ops";
import { viewExtras } from "./view-extras.svelte";

const REPO = "https://github.com/pkircher29/pixelforge";

/** CSS px per inch: PS "Print Size" shows the document at its physical size on a 96 dpi screen. */
export const SCREEN_DPI = 96;

function center() {
  return { x: canvasHost.viewW / 2, y: canvasHost.viewH / 2 };
}

function withView(fn: (e: NonNullable<typeof docStore.active>) => void) {
  const e = docStore.active;
  if (!e) return;
  fn(e);
  docStore.touch();
}

function afterCanvasChange(): void {
  const e = docStore.active;
  e?.compositor?.invalidateAll();
  canvasHost.invalidateOverlay();
}

/** Zoom for View ▸ Print Size at a document resolution. */
export function printSizeZoom(dpi: number): number {
  return clampZoom(SCREEN_DPI / Math.max(1, dpi || 72));
}

const hasDoc = (): boolean => !!docStore.active;

function setScreenMode(m: ScreenMode): void {
  toolStore.screenMode = m;
}

/** The View menu (pure list: tests read `checked` / `enabled` straight from it). */
export function viewMenuCommands(): CommandDef[] {
  return [
    { id: "view.zoomIn", label: "Zoom In", menu: "View", order: 100, shortcut: "CmdOrCtrl+=", enabled: hasDoc, run: () => withView((e) => e.viewport.zoomIn(center())) },
    { id: "view.zoomOut", label: "Zoom Out", menu: "View", order: 101, shortcut: "CmdOrCtrl+-", enabled: hasDoc, run: () => withView((e) => e.viewport.zoomOut(center())) },
    { id: "view.fit", label: "Fit on Screen", menu: "View", order: 102, shortcut: "CmdOrCtrl+0", enabled: hasDoc, run: () => withView((e) => e.viewport.fitToView(canvasHost.viewW, canvasHost.viewH, e.doc.width, e.doc.height, 32)) },
    { id: "view.actual", label: "100%", menu: "View", order: 103, shortcut: "CmdOrCtrl+1", keywords: ["actual pixels"], enabled: hasDoc, run: () => withView((e) => e.viewport.actualPixels(canvasHost.viewW, canvasHost.viewH, e.doc.width, e.doc.height)) },
    { id: "view.zoom200", label: "200%", menu: "View", order: 104, enabled: hasDoc, run: () => withView((e) => e.viewport.setZoomAt(center(), 2)) },
    { id: "view.printSize", label: "Print Size", menu: "View", order: 105, keywords: ["physical", "inches"], enabled: hasDoc, run: () => withView((e) => e.viewport.setZoomAt(center(), printSizeZoom(e.doc.meta.dpi))) },

    { id: "view.screen.standard", label: "Standard Screen Mode", menu: "View/Screen Mode", order: 200, checked: () => toolStore.screenMode === "standard", run: () => setScreenMode("standard") },
    { id: "view.screen.menu", label: "Full Screen Mode With Menu Bar", menu: "View/Screen Mode", order: 201, checked: () => toolStore.screenMode === "fullscreen-menu", run: () => setScreenMode("fullscreen-menu") },
    { id: "view.screen.full", label: "Full Screen Mode", menu: "View/Screen Mode", order: 202, checked: () => toolStore.screenMode === "fullscreen", run: () => setScreenMode("fullscreen") },
    // F cycles (palette / shortcut only; the submenu shows the three modes).
    { id: "view.screenMode", label: "Cycle Screen Mode", shortcut: "F", keywords: ["full screen"], run: () => toolStore.cycleScreenMode() },

    { id: "view.extras", label: "Extras", menu: "View", order: 300, shortcut: "CmdOrCtrl+H", keywords: ["show", "hide", "marching ants", "grid", "edges"], checked: () => viewExtras.extras, run: () => { viewExtras.toggleExtras(); docStore.touch(); } },
    { id: "view.selectionEdges", label: "Selection Edges", menu: "View/Show", order: 310, keywords: ["marching ants", "show", "hide"], checked: () => ui.showSelectionEdges, run: () => { ui.showSelectionEdges = !ui.showSelectionEdges; if (ui.showSelectionEdges && !viewExtras.extras) viewExtras.extras = true; ui.persist(); viewExtras.persist(); docStore.touch(); } },
    { id: "view.layerEdges", label: "Layer Edges", menu: "View/Show", order: 311, keywords: ["bounds", "show", "hide"], checked: () => viewExtras.layerEdges, run: () => { viewExtras.toggle("layerEdges"); docStore.touch(); } },
    { id: "view.pixelGrid", label: "Pixel Grid", menu: "View/Show", order: 312, shortcut: "CmdOrCtrl+'", keywords: ["grid", "show", "hide"], checked: () => ui.showPixelGrid, run: () => { ui.showPixelGrid = !ui.showPixelGrid; ui.persist(); docStore.touch(); } },
    { id: "view.grid", label: "Grid", menu: "View/Show", order: 313, keywords: ["gridlines", "show", "hide"], checked: () => viewExtras.grid, run: () => { viewExtras.toggle("grid"); docStore.touch(); } },

    { id: "view.rulers", label: "Rulers", menu: "View", order: 400, shortcut: "CmdOrCtrl+R", keywords: ["ruler", "show", "hide"], checked: () => ui.showRulers, run: () => ui.toggleRulers() },

    { id: "view.snap", label: "Snap", menu: "View", order: 500, keywords: ["snap to"], checked: () => viewExtras.snap, run: () => viewExtras.toggle("snap") },
  ];
}

export function registerViewMenu(): void {
  registerCommands(viewMenuCommands());
}

registerCommands([
  // Image
  { id: "image.flipH", label: "Flip Canvas Horizontal", menu: "Image/Image Rotation", order: 300, enabled: () => !!docStore.doc, run: () => { docStore.exec(new FlipCanvasCommand("h")); afterCanvasChange(); } },
  { id: "image.flipV", label: "Flip Canvas Vertical", menu: "Image/Image Rotation", order: 301, enabled: () => !!docStore.doc, run: () => { docStore.exec(new FlipCanvasCommand("v")); afterCanvasChange(); } },
  { id: "image.rotate90", label: "90° Clockwise", menu: "Image/Image Rotation", order: 221, enabled: () => !!docStore.doc, run: () => { docStore.exec(new RotateCanvasCommand(1)); afterCanvasChange(); } },
  { id: "image.rotate270", label: "90° Counter Clockwise", menu: "Image/Image Rotation", order: 222, enabled: () => !!docStore.doc, run: () => { docStore.exec(new RotateCanvasCommand(3)); afterCanvasChange(); } },
  { id: "image.rotate180", label: "180°", menu: "Image/Image Rotation", order: 220, enabled: () => !!docStore.doc, run: () => { docStore.exec(new RotateCanvasCommand(2)); afterCanvasChange(); } },

  // Window
  { id: "window.palette", label: "Command palette…", menu: "Window", order: 100, shortcut: "CmdOrCtrl+K", keywords: ["search commands"], run: () => { ui.paletteOpen = !ui.paletteOpen; } },
  { id: "window.paletteAlt", label: "Command palette…", shortcut: "CmdOrCtrl+Shift+P", run: () => { ui.paletteOpen = !ui.paletteOpen; } },
  { id: "window.nextTab", label: "Next document", menu: "Window", order: 200, shortcut: "Ctrl+Tab", enabled: () => docStore.docs.length > 1, run: () => docStore.cycle(1) },
  { id: "window.prevTab", label: "Previous document", menu: "Window", order: 201, shortcut: "Ctrl+Shift+Tab", enabled: () => docStore.docs.length > 1, run: () => docStore.cycle(-1) },

  // Help
  { id: "help.about", label: "About Pixelforge", menu: "Help", order: 100, run: () => openDialog<{ compositor: string }, void>(AboutDialog, { compositor: canvasHost.compositorKind || "none" }) },
  { id: "help.github", label: "GitHub repository", menu: "Help", order: 200, keywords: ["source", "issues"], run: () => (isTauri() ? openUrl(REPO) : void window.open(REPO, "_blank", "noopener")) },
  { id: "help.issues", label: "Report a problem", menu: "Help", order: 201, run: () => (isTauri() ? openUrl(`${REPO}/issues/new`) : void window.open(`${REPO}/issues/new`, "_blank", "noopener")) },
  // No accelerator: Ctrl+Shift+I is Select ▸ Inverse; the webview's own F12 opens devtools in dev builds.
  { id: "help.devtools", label: "Toggle developer tools", menu: "Help", order: 300, run: () => { if (import.meta.env.DEV) console.info("[pixelforge] devtools: press Ctrl+Shift+I / F12 in the webview"); } },
  { id: "window.maximize", label: "Toggle maximize", shortcut: "F11", run: () => (isTauri() ? getCurrentWindow().toggleMaximize() : undefined) },
]);
registerViewMenu();

/** Register `Window/<panel>` toggles for every registered panel (call from an effect). */
export function syncWindowPanelCommands(): void {
  for (const p of getPanels()) {
    registerCommand({
      id: `window.panel.${p.id}`,
      label: `${p.title} panel`,
      menu: "Window/Panels",
      order: 300 + p.order,
      keywords: ["show", "hide", "toggle", p.title.toLowerCase()],
      run: () => ui.togglePanel(p.id),
    });
  }
}
