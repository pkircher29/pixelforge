/**
 * panels-v2 registrations (imported once from `register.ts`): Color + Swatches (group
 * `color`), Navigator + Info (group `navigator`), History (group `history`), each with
 * its PS ≡ menu; the Color Picker command; the View-menu override and the Grid / Layer
 * Edges overlay.
 */
import { mount } from "svelte";
import { getCommand, registerCommand, registerPanel, type CommandDef } from "../registry.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { openColorPicker } from "../dialogs/color-picker";
import { registerViewMenu } from "../commands/view";
import ViewExtrasOverlay from "../commands/ViewExtrasOverlay.svelte";
import ColorPanel from "./ColorPanel.svelte";
import SwatchesPanel from "./SwatchesPanel.svelte";
import NavigatorPanel from "./NavigatorPanel.svelte";
import InfoPanel from "./InfoPanel.svelte";
import HistoryPanel from "./HistoryPanel.svelte";
import { COLOR_PANEL_MODES, colorPanelUi } from "./Color.store.svelte";
import { swatchStore } from "./Swatches.store.svelte";
import { exportSwatches, importSwatches } from "./Swatches.io";
import { navigatorUi, VIEW_BOX_COLORS } from "./Navigator.store.svelte";
import { infoUi } from "./Info.store.svelte";
import { INFO_COLOR_MODES } from "./info-model";
import "./History.commands";

function proxy(id: string, label?: string): CommandDef {
  return {
    id: `panel.${id}`,
    get label() {
      return label ?? getCommand(id)?.label ?? id;
    },
    get shortcut() {
      return getCommand(id)?.shortcut;
    },
    enabled: () => {
      const c = getCommand(id);
      return !!c && (!c.enabled || c.enabled());
    },
    run: () => void getCommand(id)?.run(),
  } as CommandDef;
}

registerCommand({
  id: "color.pick",
  label: "Color Picker…",
  keywords: ["foreground", "color", "hex", "hsb"],
  run: async () => {
    const c = await openColorPicker(toolStore.fg, { title: "Color Picker (Foreground Color)" });
    if (c) toolStore.setFg(c);
  },
});
registerCommand({
  id: "color.pickBackground",
  label: "Color Picker (Background)…",
  keywords: ["background", "color"],
  run: async () => {
    const c = await openColorPicker(toolStore.bg, { title: "Color Picker (Background Color)" });
    if (c) toolStore.setBg(c);
  },
});

const colorMenu: CommandDef[] = COLOR_PANEL_MODES.map((m) => ({ id: `panel.color.mode.${m.id}`, label: m.label, checked: () => colorPanelUi.mode === m.id, run: () => colorPanelUi.setMode(m.id) }));

const swatchesMenu: CommandDef[] = [
  { id: "panel.swatches.new", label: "New Swatch Preset…", run: () => void swatchStore.add({ ...toolStore.fg }) },
  { id: "panel.swatches.group", label: "New Swatch Group…", run: () => void swatchStore.addGroup(`Group ${swatchStore.groups.length + 1}`) },
  { id: "panel.swatches.small", label: "Small Thumbnail", checked: () => swatchStore.thumb === "small", run: () => swatchStore.setThumb("small") },
  { id: "panel.swatches.large", label: "Large Thumbnail", checked: () => swatchStore.thumb === "large", run: () => swatchStore.setThumb("large") },
  { id: "panel.swatches.import", label: "Import Swatches… (.json)", run: () => void importSwatches() },
  { id: "panel.swatches.export", label: "Export Selected Swatches… (.json)", run: () => void exportSwatches() },
  { id: "panel.swatches.reset", label: "Restore Default Swatches", run: () => swatchStore.resetToDefault() },
];

const navigatorMenu: CommandDef[] = VIEW_BOX_COLORS.map((c) => ({ id: `panel.navigator.box.${c.id}`, label: `View Box: ${c.label}`, checked: () => navigatorUi.boxColor === c.id, run: () => navigatorUi.setBoxColor(c.id) }));

const infoMenu: CommandDef[] = [
  ...INFO_COLOR_MODES.map((m) => ({ id: `panel.info.first.${m.id}`, label: `First Readout: ${m.label}`, checked: () => infoUi.first === m.id, run: () => { infoUi.first = m.id; infoUi.persist(); } })),
  ...INFO_COLOR_MODES.map((m) => ({ id: `panel.info.second.${m.id}`, label: `Second Readout: ${m.label}`, checked: () => infoUi.second === m.id, run: () => { infoUi.second = m.id; infoUi.persist(); } })),
  { id: "panel.info.docsize", label: "Show Document Sizes", checked: () => infoUi.showDocSize, run: () => { infoUi.showDocSize = !infoUi.showDocSize; infoUi.persist(); } },
  { id: "panel.info.tips", label: "Show Tool Hints", checked: () => infoUi.showTips, run: () => { infoUi.showTips = !infoUi.showTips; infoUi.persist(); } },
];

const historyMenu: CommandDef[] = [
  proxy("edit.stepForward"),
  proxy("edit.stepBackward"),
  proxy("history.takeSnapshot"),
  proxy("history.delete"),
  proxy("history.clear"),
  proxy("history.newDocument"),
  proxy("history.options"),
];

registerPanel({ id: "color", title: "Color", dock: "right", order: 1, group: "color", component: ColorPanel, icon: "color", preferredSize: 200, menu: colorMenu });
registerPanel({ id: "swatches", title: "Swatches", dock: "right", order: 2, group: "color", component: SwatchesPanel, icon: "swatches", preferredSize: 200, menu: swatchesMenu });
registerPanel({ id: "navigator", title: "Navigator", dock: "right", order: 5, group: "navigator", component: NavigatorPanel, icon: "navigator", preferredSize: 200, menu: navigatorMenu });
registerPanel({ id: "info", title: "Info", dock: "right", order: 6, group: "navigator", component: InfoPanel, icon: "info", preferredSize: 200, menu: infoMenu });
registerPanel({ id: "history", title: "History", dock: "right", order: 30, group: "history", component: HistoryPanel, icon: "history", preferredSize: 240, menu: historyMenu });

// This module loads after `shell-commands.ts`: make the PS View menu win.
registerViewMenu();

if (typeof document !== "undefined" && !import.meta.env.VITEST) {
  mount(ViewExtrasOverlay, { target: document.body });
}
