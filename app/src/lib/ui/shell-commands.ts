/**
 * Shell-owned commands: View ▸ Rulers, Window ▸ <panel> toggles with check marks,
 * Window ▸ Workspace, the Type menu stubs (Wave 6 fills them), screen mode / quick mask.
 * Imported once by `App.svelte` after `./commands` so same-id registrations here win.
 */
import { registerCommand, registerCommands, getPanels } from "./registry.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { docStore } from "$lib/stores/doc.svelte";
import { openDialog } from "./dialogs/dialogs.svelte";
import PreferencesDialog from "./dialogs/PreferencesDialog.svelte";

const prefs = (page: string) => async (): Promise<void> => {
  await openDialog<{ page: string }, void>(PreferencesDialog, { page });
};

registerCommands([
  { id: "view.rulers", label: "Rulers", menu: "View", order: 210, shortcut: "CmdOrCtrl+R", keywords: ["ruler", "show", "hide"], checked: () => ui.showRulers, run: () => ui.toggleRulers() },
  { id: "view.pixelGrid", label: "Pixel Grid", menu: "View", order: 200, shortcut: "CmdOrCtrl+'", keywords: ["grid", "show", "hide"], checked: () => ui.showPixelGrid, run: () => { ui.showPixelGrid = !ui.showPixelGrid; ui.persist(); docStore.touch(); } },
  { id: "view.selectionEdges", label: "Selection Edges", menu: "View", order: 201, shortcut: "CmdOrCtrl+H", keywords: ["marching ants", "extras", "show", "hide"], checked: () => ui.showSelectionEdges, run: () => { ui.showSelectionEdges = !ui.showSelectionEdges; ui.persist(); docStore.touch(); } },
  { id: "view.screenMode", label: "Screen Mode", menu: "View", order: 900, shortcut: "F", keywords: ["full screen"], run: () => toolStore.cycleScreenMode() },
  { id: "select.quickMask", label: "Edit in Quick Mask Mode", menu: "Select", order: 900, shortcut: "Q", checked: () => toolStore.quickMask, run: () => toolStore.toggleQuickMask() },

  // Window ▸ Workspace
  { id: "window.workspace.essentials", label: "Essentials (Default)", menu: "Window/Workspace", order: 10, checked: () => ui.workspace.name === "Essentials", run: () => {} },
  { id: "window.resetLayout", label: "Reset Essentials", menu: "Window/Workspace", order: 100, keywords: ["panels", "layout", "workspace"], run: () => ui.resetWorkspace() },
  { id: "window.collapseIcons", label: "Collapse Panels to Icons", menu: "Window", order: 250, checked: () => ui.workspace.iconized, run: () => ui.setIconized(!ui.workspace.iconized) },

  // Type menu — editable type layers are Wave 6 (`tools-v2`); keep the menu present.
  { id: "type.panels.character", label: "Character", menu: "Type/Panels", order: 100, enabled: () => false, run: () => {} },
  { id: "type.panels.paragraph", label: "Paragraph", menu: "Type/Panels", order: 101, enabled: () => false, run: () => {} },
  { id: "type.antialias", label: "Anti-Alias", menu: "Type", order: 200, enabled: () => false, run: () => {} },
  { id: "type.orientation.h", label: "Horizontal", menu: "Type/Orientation", order: 300, enabled: () => false, run: () => {} },
  { id: "type.orientation.v", label: "Vertical", menu: "Type/Orientation", order: 301, enabled: () => false, run: () => {} },
  { id: "type.rasterize", label: "Rasterize Type Layer", menu: "Type", order: 400, enabled: () => false, run: () => {} },

  // Preferences pages (Edit ▸ Preferences ▸ …)
  { id: "edit.preferences", label: "General…", menu: "Edit/Preferences", order: 900, shortcut: "CmdOrCtrl+,", keywords: ["settings"], run: prefs("general") },
  { id: "edit.preferences.interface", label: "Interface…", menu: "Edit/Preferences", order: 901, run: prefs("interface") },
  { id: "edit.preferences.tools", label: "Tools…", menu: "Edit/Preferences", order: 902, run: prefs("tools") },
  { id: "edit.preferences.history", label: "History…", menu: "Edit/Preferences", order: 903, run: prefs("history") },
  { id: "edit.preferences.transparency", label: "Transparency & Gamut…", menu: "Edit/Preferences", order: 904, run: prefs("transparency") },
  { id: "edit.preferences.cursors", label: "Cursors…", menu: "Edit/Preferences", order: 905, run: prefs("cursors") },
  { id: "edit.preferences.units", label: "Units & Rulers…", menu: "Edit/Preferences", order: 906, run: prefs("units") },
  // v0.1 had Preferences under File too; PS keeps it under Edit (Windows). Palette-only now.
  { id: "file.preferences", label: "Preferences…", keywords: ["settings", "options"], run: prefs("general") },
]);

/** Register `Window/<panel>` toggles (with ✓) for every registered panel (call from an effect). */
export function syncWindowPanelCommands(): void {
  // Photoshop lists panels alphabetically in the Window menu.
  const panels = [...getPanels()].sort((a, b) => a.title.localeCompare(b.title));
  panels.forEach((p, i) => {
    registerCommand({
      id: `window.panel.${p.id}`,
      label: p.title,
      menu: "Window",
      order: 300 + i / 100,
      keywords: ["panel", "show", "hide", "toggle", p.title.toLowerCase()],
      checked: () => ui.isPanelVisible(p.id) && !ui.workspace.iconized,
      run: () => ui.togglePanel(p.id),
    });
  });
}
