/** Register the shell's own panels. Other agents register theirs from their `register.ts`. */
import { registerPanel, getCommand, type CommandDef } from "../registry.svelte";
import LayersPanel from "./LayersPanel.svelte";
import ChannelsPanel from "./ChannelsPanel.svelte";
import PathsPanel from "./PathsPanel.svelte";
import PropertiesPanel from "./PropertiesPanel.svelte";
import { LAYERS_PANEL_MENU_IDS } from "../commands/layer";
import { layersUi } from "./Layers.store.svelte";
import "./Channels.commands";
import "./Paths.commands";
// panels-v2: Color, Swatches, Navigator, Info, History (+ View menu, Color Picker).
import "./register-panels-v2";
import BrushSettingsPanel from "./BrushSettingsPanel.svelte";
import BrushesPanel from "./BrushesPanel.svelte";
import CharacterPanel from "./CharacterPanel.svelte";
import ParagraphPanel from "./ParagraphPanel.svelte";
import "$lib/tools/register";

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

// tools-v2: Brush Settings / Brushes, Character / Paragraph (+ Type menu, Stroke/Fill Path).
registerPanel({ id: "brush-settings", title: "Brush Settings", dock: "right", order: 60, group: "brush", component: BrushSettingsPanel, icon: "brush", preferredSize: 300 });
registerPanel({ id: "brushes", title: "Brushes", dock: "right", order: 61, group: "brush", component: BrushesPanel, icon: "brush-size", preferredSize: 300 });
registerPanel({ id: "character", title: "Character", dock: "right", order: 70, group: "type", component: CharacterPanel, icon: "type-h", preferredSize: 240 });
registerPanel({ id: "paragraph", title: "Paragraph", dock: "right", order: 71, group: "type", component: ParagraphPanel, icon: "type", preferredSize: 160 });
