/** Register the shell's own panels. Other agents register theirs from their `register.ts`. */
import { registerPanel, getCommand, type CommandDef } from "../registry.svelte";
import LayersPanel from "./LayersPanel.svelte";
import ChannelsPanel from "./ChannelsPanel.svelte";
import PathsPanel from "./PathsPanel.svelte";
import HistoryPanel from "./HistoryPanel.svelte";
import PropertiesPanel from "./PropertiesPanel.svelte";
import { LAYERS_PANEL_MENU_IDS } from "../commands/layer";
import { layersUi } from "./Layers.store.svelte";
import "./Channels.commands";
import "./Paths.commands";

/** Panel ≡ items that proxy to registered commands (resolved lazily so order of registration doesn't matter). */
function proxy(id: string): CommandDef {
  return {
    id: `panel.${id}`,
    label: getCommand(id)?.label ?? id,
    get shortcut() {
      return getCommand(id)?.shortcut;
    },
    enabled: () => {
      const c = getCommand(id);
      return !!c && (!c.enabled || c.enabled());
    },
    checked: () => !!getCommand(id)?.checked?.(),
    run: () => void getCommand(id)?.run(),
  } as CommandDef;
}

const layersMenu: CommandDef[] = [
  ...LAYERS_PANEL_MENU_IDS.map(proxy),
  { id: "panel.layers.thumbs.none", label: "Thumbnails: None", checked: () => layersUi.thumbSize === "none", run: () => layersUi.setThumbSize("none") },
  { id: "panel.layers.thumbs.small", label: "Thumbnails: Small", checked: () => layersUi.thumbSize === "small", run: () => layersUi.setThumbSize("small") },
  { id: "panel.layers.thumbs.medium", label: "Thumbnails: Medium", checked: () => layersUi.thumbSize === "medium", run: () => layersUi.setThumbSize("medium") },
  { id: "panel.layers.thumbs.large", label: "Thumbnails: Large", checked: () => layersUi.thumbSize === "large", run: () => layersUi.setThumbSize("large") },
];

const channelsMenu: CommandDef[] = ["channels.new", "channels.duplicate", "channels.delete", "channels.spot", "channels.options"].map(proxy);
const pathsMenu: CommandDef[] = ["paths.new", "paths.duplicate", "paths.delete", "paths.makeWork", "paths.makeSelection", "paths.fill", "paths.stroke", "paths.clipping"].map(proxy);

registerPanel({ id: "properties", title: "Properties", dock: "right", order: 20, group: "properties", component: PropertiesPanel, icon: "properties", preferredSize: 220 });
registerPanel({ id: "layers", title: "Layers", dock: "right", order: 10, group: "layers", component: LayersPanel, icon: "layers", preferredSize: 360, menu: layersMenu });
registerPanel({ id: "channels", title: "Channels", dock: "right", order: 11, group: "layers", component: ChannelsPanel, icon: "channels", preferredSize: 360, menu: channelsMenu });
registerPanel({ id: "paths", title: "Paths", dock: "right", order: 12, group: "layers", component: PathsPanel, icon: "paths", preferredSize: 360, menu: pathsMenu });
registerPanel({ id: "history", title: "History", dock: "right", order: 30, group: "history", component: HistoryPanel, icon: "history", preferredSize: 240 });
