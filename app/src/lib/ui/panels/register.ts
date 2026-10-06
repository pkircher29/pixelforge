/** Register the shell's own panels. Other agents register theirs from their `register.ts`. */
import { registerPanel } from "../registry.svelte";
import LayersPanel from "./LayersPanel.svelte";
import HistoryPanel from "./HistoryPanel.svelte";
import PropertiesPanel from "./PropertiesPanel.svelte";

registerPanel({ id: "properties", title: "Properties", dock: "right", order: 20, group: "properties", component: PropertiesPanel, icon: "properties", preferredSize: 220 });
registerPanel({ id: "layers", title: "Layers", dock: "right", order: 10, group: "layers", component: LayersPanel, icon: "layers", preferredSize: 360 });
registerPanel({ id: "history", title: "History", dock: "right", order: 30, group: "history", component: HistoryPanel, icon: "history", preferredSize: 240 });
