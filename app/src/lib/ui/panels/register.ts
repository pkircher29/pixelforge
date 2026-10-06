/** Register the shell's own panels. Other agents register theirs from their `register.ts`. */
import { Layers, History, SlidersHorizontal } from "@lucide/svelte";
import { registerPanel } from "../registry.svelte";
import LayersPanel from "./LayersPanel.svelte";
import HistoryPanel from "./HistoryPanel.svelte";
import PropertiesPanel from "./PropertiesPanel.svelte";

registerPanel({ id: "layers", title: "Layers", dock: "right", order: 10, component: LayersPanel, icon: Layers, preferredSize: 360 });
registerPanel({ id: "properties", title: "Properties", dock: "right", order: 20, component: PropertiesPanel, icon: SlidersHorizontal, preferredSize: 220, collapsed: true });
registerPanel({ id: "history", title: "History", dock: "right", order: 30, component: HistoryPanel, icon: History, preferredSize: 240 });
