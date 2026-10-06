/** Image (canvas flips/rotates), View, Window and Help menus. */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { docStore } from "$lib/stores/doc.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { registerCommand, registerCommands, getPanels } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import AboutDialog from "../dialogs/AboutDialog.svelte";
import { canvasHost } from "../canvas/host.svelte";
import { FlipCanvasCommand, RotateCanvasCommand } from "./canvas-ops";

const REPO = "https://github.com/pkircher29/pixelforge";

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

registerCommands([
  // Image
  { id: "image.flipH", label: "Flip canvas horizontal", menu: "Image/Rotate canvas", order: 300, enabled: () => !!docStore.doc, run: () => { docStore.exec(new FlipCanvasCommand("h")); afterCanvasChange(); } },
  { id: "image.flipV", label: "Flip canvas vertical", menu: "Image/Rotate canvas", order: 301, enabled: () => !!docStore.doc, run: () => { docStore.exec(new FlipCanvasCommand("v")); afterCanvasChange(); } },
  { id: "image.rotate90", label: "90° clockwise", menu: "Image/Rotate canvas", order: 310, enabled: () => !!docStore.doc, run: () => { docStore.exec(new RotateCanvasCommand(1)); afterCanvasChange(); } },
  { id: "image.rotate270", label: "90° counter-clockwise", menu: "Image/Rotate canvas", order: 311, enabled: () => !!docStore.doc, run: () => { docStore.exec(new RotateCanvasCommand(3)); afterCanvasChange(); } },
  { id: "image.rotate180", label: "180°", menu: "Image/Rotate canvas", order: 312, enabled: () => !!docStore.doc, run: () => { docStore.exec(new RotateCanvasCommand(2)); afterCanvasChange(); } },

  // View
  { id: "view.zoomIn", label: "Zoom in", menu: "View", order: 100, shortcut: "CmdOrCtrl+=", enabled: () => !!docStore.active, run: () => withView((e) => e.viewport.zoomIn(center())) },
  { id: "view.zoomOut", label: "Zoom out", menu: "View", order: 101, shortcut: "CmdOrCtrl+-", enabled: () => !!docStore.active, run: () => withView((e) => e.viewport.zoomOut(center())) },
  { id: "view.fit", label: "Fit on screen", menu: "View", order: 102, shortcut: "CmdOrCtrl+0", enabled: () => !!docStore.active, run: () => withView((e) => e.viewport.fitToView(canvasHost.viewW, canvasHost.viewH, e.doc.width, e.doc.height, 32)) },
  { id: "view.actual", label: "Actual pixels (100%)", menu: "View", order: 103, shortcut: "CmdOrCtrl+1", enabled: () => !!docStore.active, run: () => withView((e) => e.viewport.actualPixels(canvasHost.viewW, canvasHost.viewH, e.doc.width, e.doc.height)) },
  { id: "view.zoom200", label: "200%", menu: "View", order: 104, shortcut: "CmdOrCtrl+2", enabled: () => !!docStore.active, run: () => withView((e) => e.viewport.setZoomAt(center(), 2)) },
  { id: "view.pixelGrid", label: "Toggle pixel grid", menu: "View", order: 200, shortcut: "CmdOrCtrl+'", keywords: ["grid", "show", "hide"], run: () => { ui.showPixelGrid = !ui.showPixelGrid; ui.persist(); docStore.touch(); } },
  { id: "view.selectionEdges", label: "Toggle selection edges", menu: "View", order: 201, shortcut: "CmdOrCtrl+H", keywords: ["marching ants", "extras", "show", "hide"], run: () => { ui.showSelectionEdges = !ui.showSelectionEdges; ui.persist(); docStore.touch(); } },

  // Window
  { id: "window.palette", label: "Command palette…", menu: "Window", order: 100, shortcut: "CmdOrCtrl+K", keywords: ["search commands"], run: () => { ui.paletteOpen = !ui.paletteOpen; } },
  { id: "window.paletteAlt", label: "Command palette…", shortcut: "CmdOrCtrl+Shift+P", run: () => { ui.paletteOpen = !ui.paletteOpen; } },
  { id: "window.nextTab", label: "Next document", menu: "Window", order: 200, shortcut: "Ctrl+Tab", enabled: () => docStore.docs.length > 1, run: () => docStore.cycle(1) },
  { id: "window.prevTab", label: "Previous document", menu: "Window", order: 201, shortcut: "Ctrl+Shift+Tab", enabled: () => docStore.docs.length > 1, run: () => docStore.cycle(-1) },
  { id: "window.resetLayout", label: "Reset layout", menu: "Window", order: 900, run: () => ui.resetLayout() },

  // Help
  { id: "help.about", label: "About Pixelforge", menu: "Help", order: 100, run: () => openDialog<{ compositor: string }, void>(AboutDialog, { compositor: canvasHost.compositorKind || "none" }) },
  { id: "help.github", label: "GitHub repository", menu: "Help", order: 200, keywords: ["source", "issues"], run: () => (isTauri() ? openUrl(REPO) : void window.open(REPO, "_blank", "noopener")) },
  { id: "help.issues", label: "Report a problem", menu: "Help", order: 201, run: () => (isTauri() ? openUrl(`${REPO}/issues/new`) : void window.open(`${REPO}/issues/new`, "_blank", "noopener")) },
  { id: "help.devtools", label: "Toggle developer tools", menu: "Help", order: 300, shortcut: "CmdOrCtrl+Shift+I", run: () => { if (import.meta.env.DEV) console.info("[pixelforge] devtools: press Ctrl+Shift+I / F12 in the webview"); } },
  { id: "window.maximize", label: "Toggle maximize", shortcut: "F11", run: () => (isTauri() ? getCurrentWindow().toggleMaximize() : undefined) },
]);

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
