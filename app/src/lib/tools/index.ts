/**
 * Tool registry: toolbar order, fly-out groups and key lookup.
 */
import type { Tool } from "./types";
import { MoveTool } from "./move";
import { MarqueeTool } from "./marquee";
import { LassoTool } from "./lasso";
import { WandTool } from "./wand";
import { CropTool } from "./crop";
import { EyedropperTool } from "./eyedropper";
import { BrushTool } from "./brush";
import { BucketTool } from "./bucket";
import { GradientTool } from "./gradient";
import { TextTool } from "./text";
import { ZoomTool, HandTool } from "./navigate";
import { parseAccelerator, matchesAccelerator, IS_MAC } from "$lib/shortcuts";

export type { Tool, ToolContext, ToolEvent, ToolOption, SelectionMode, IconComponent } from "./types";
export { TextTool, CropTool };

export const TOOLS: readonly Tool[] = [
  new MoveTool(),
  new MarqueeTool("rect"),
  new MarqueeTool("ellipse"),
  new LassoTool(false),
  new LassoTool(true),
  new WandTool(),
  new CropTool(),
  new EyedropperTool(),
  new BrushTool("paint"),
  new BrushTool("erase"),
  new BucketTool(),
  new GradientTool(),
  new BrushTool("clone"),
  new TextTool(),
  new ZoomTool(),
  new HandTool(),
];

const byId = new Map(TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): Tool | undefined {
  return byId.get(id);
}

/** Toolbar slots: a tool, or a fly-out group of tools sharing a slot. */
export interface ToolbarSlot {
  /** Group id or the tool id for singletons. */
  id: string;
  tools: Tool[];
}

export function toolbarSlots(tools: readonly Tool[] = TOOLS): ToolbarSlot[] {
  const slots: ToolbarSlot[] = [];
  const groups = new Map<string, ToolbarSlot>();
  for (const t of tools) {
    if (t.group) {
      let s = groups.get(t.group);
      if (!s) {
        s = { id: t.group, tools: [] };
        groups.set(t.group, s);
        slots.push(s);
      }
      s.tools.push(t);
    } else {
      slots.push({ id: t.id, tools: [t] });
    }
  }
  return slots;
}

/**
 * Resolve a keydown to a tool. Pressing the key of a fly-out group cycles through its
 * tools (Photoshop's Shift-cycle without the Shift). Returns the tool to activate.
 */
export function toolForKey(
  e: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  currentId: string,
  tools: readonly Tool[] = TOOLS,
): Tool | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const matches = tools.filter((t) => {
    const acc = parseAccelerator(t.shortcut);
    return acc ? matchesAccelerator(acc, e, IS_MAC) : false;
  });
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;
  const i = matches.findIndex((t) => t.id === currentId);
  return matches[(i + 1) % matches.length]!;
}
