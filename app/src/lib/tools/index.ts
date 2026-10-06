/**
 * Tool registry: toolbar order, fly-out groups and key lookup.
 *
 * `TOOL_GROUPS` is the Photoshop CC single-column toolbar (PLAN-v2 §2). Every slot lists
 * its members in fly-out order; members whose tool class doesn't exist yet still render
 * (disabled) so the column is complete today and Wave 6 only has to ship the classes.
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
import { setGroupResolver } from "$lib/stores/tool.svelte";

export type { Tool, ToolContext, ToolEvent, ToolOption, ToolPreset, SelectionMode, IconComponent } from "./types";
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

/** One entry of a fly-out as declared by the toolbar spec. */
export interface ToolGroupMember {
  /** Tool id (matches `Tool.id` once the tool exists). */
  id: string;
  /** Display name, PS wording ("Rectangular Marquee Tool"). */
  name: string;
  /** Glyph name when it differs from `id`. */
  glyph?: string;
}

export interface ToolGroupDef {
  id: string;
  /** Single-letter shortcut shown in the fly-out ("M"). */
  key: string;
  members: ToolGroupMember[];
}

/** Photoshop CC toolbar, top to bottom (PLAN-v2 §2). */
export const TOOL_GROUPS: readonly ToolGroupDef[] = [
  { id: "move", key: "V", members: [{ id: "move", name: "Move Tool" }, { id: "artboard", name: "Artboard Tool" }] },
  {
    id: "marquee",
    key: "M",
    members: [
      { id: "marquee-rect", name: "Rectangular Marquee Tool" },
      { id: "marquee-ellipse", name: "Elliptical Marquee Tool" },
      { id: "marquee-row", name: "Single Row Marquee Tool" },
      { id: "marquee-column", name: "Single Column Marquee Tool" },
    ],
  },
  {
    id: "lasso",
    key: "L",
    members: [
      { id: "lasso", name: "Lasso Tool" },
      { id: "lasso-polygon", name: "Polygonal Lasso Tool" },
      { id: "lasso-magnetic", name: "Magnetic Lasso Tool" },
    ],
  },
  { id: "quickselect", key: "W", members: [{ id: "quick-select", name: "Quick Selection Tool" }, { id: "wand", name: "Magic Wand Tool" }] },
  {
    id: "crop",
    key: "C",
    members: [
      { id: "crop", name: "Crop Tool" },
      { id: "crop-perspective", name: "Perspective Crop Tool" },
      { id: "slice", name: "Slice Tool" },
    ],
  },
  {
    id: "eyedropper",
    key: "I",
    members: [
      { id: "eyedropper", name: "Eyedropper Tool" },
      { id: "color-sampler", name: "Color Sampler Tool" },
      { id: "ruler", name: "Ruler Tool" },
      { id: "note", name: "Note Tool" },
    ],
  },
  {
    id: "healing",
    key: "J",
    members: [
      { id: "healing-spot", name: "Spot Healing Brush Tool" },
      { id: "healing-brush", name: "Healing Brush Tool" },
      { id: "patch", name: "Patch Tool" },
      { id: "content-aware-move", name: "Content-Aware Move Tool" },
      { id: "red-eye", name: "Red Eye Tool" },
    ],
  },
  {
    id: "brush",
    key: "B",
    members: [
      { id: "brush", name: "Brush Tool" },
      { id: "pencil", name: "Pencil Tool" },
      { id: "color-replacement", name: "Color Replacement Tool" },
      { id: "mixer-brush", name: "Mixer Brush Tool" },
    ],
  },
  { id: "stamp", key: "S", members: [{ id: "clone", name: "Clone Stamp Tool" }, { id: "pattern-stamp", name: "Pattern Stamp Tool" }] },
  { id: "history", key: "Y", members: [{ id: "history-brush", name: "History Brush Tool" }, { id: "art-history-brush", name: "Art History Brush Tool" }] },
  {
    id: "eraser",
    key: "E",
    members: [
      { id: "eraser", name: "Eraser Tool" },
      { id: "background-eraser", name: "Background Eraser Tool" },
      { id: "magic-eraser", name: "Magic Eraser Tool" },
    ],
  },
  { id: "gradient", key: "G", members: [{ id: "gradient", name: "Gradient Tool" }, { id: "bucket", name: "Paint Bucket Tool" }] },
  { id: "blur", key: "", members: [{ id: "blur", name: "Blur Tool" }, { id: "sharpen", name: "Sharpen Tool" }, { id: "smudge", name: "Smudge Tool" }] },
  { id: "dodge", key: "O", members: [{ id: "dodge", name: "Dodge Tool" }, { id: "burn", name: "Burn Tool" }, { id: "sponge", name: "Sponge Tool" }] },
  {
    id: "pen",
    key: "P",
    members: [
      { id: "pen", name: "Pen Tool" },
      { id: "pen-freeform", name: "Freeform Pen Tool" },
      { id: "pen-curvature", name: "Curvature Pen Tool" },
      { id: "pen-add", name: "Add Anchor Point Tool" },
      { id: "pen-delete", name: "Delete Anchor Point Tool" },
      { id: "pen-convert", name: "Convert Point Tool" },
    ],
  },
  {
    id: "type",
    key: "T",
    members: [
      { id: "text", name: "Horizontal Type Tool", glyph: "type-h" },
      { id: "type-v", name: "Vertical Type Tool" },
      { id: "type-mask-h", name: "Horizontal Type Mask Tool" },
      { id: "type-mask-v", name: "Vertical Type Mask Tool" },
    ],
  },
  { id: "pathselect", key: "A", members: [{ id: "path-select", name: "Path Selection Tool" }, { id: "direct-select", name: "Direct Selection Tool" }] },
  {
    id: "shape",
    key: "U",
    members: [
      { id: "shape-rect", name: "Rectangle Tool" },
      { id: "shape-rounded", name: "Rounded Rectangle Tool" },
      { id: "shape-ellipse", name: "Ellipse Tool" },
      { id: "shape-polygon", name: "Polygon Tool" },
      { id: "shape-line", name: "Line Tool" },
      { id: "shape-custom", name: "Custom Shape Tool" },
    ],
  },
  { id: "hand", key: "H", members: [{ id: "hand", name: "Hand Tool" }, { id: "rotate-view", name: "Rotate View Tool" }] },
  { id: "zoom", key: "Z", members: [{ id: "zoom", name: "Zoom Tool" }] },
];

/** Every tool id named in the toolbar spec (real or placeholder). */
export const SPEC_TOOL_IDS: readonly string[] = TOOL_GROUPS.flatMap((g) => g.members.map((m) => m.id));

/** A fly-out row: spec member + the live tool when it exists. */
export interface ToolSlotMember extends ToolGroupMember {
  tool: Tool | null;
  /** Key label for the row ("M"; "Shift+G" for secondary keys stays as the spec key). */
  key: string;
}

/** Toolbar slots: a tool, or a fly-out group of tools sharing a slot. */
export interface ToolbarSlot {
  /** Group id (or the tool id for a tool outside the spec). */
  id: string;
  key: string;
  /** Live tools only, in fly-out order. */
  tools: Tool[];
  /** Spec members in fly-out order, placeholders included. */
  members: ToolSlotMember[];
}

/**
 * Build the toolbar from the spec plus any registered tools the spec doesn't know
 * (they get their own slot at the end so nothing registered is unreachable).
 */
export function toolbarSlots(tools: readonly Tool[] = TOOLS, groups: readonly ToolGroupDef[] = TOOL_GROUPS): ToolbarSlot[] {
  const index = new Map(tools.map((t) => [t.id, t]));
  const placed = new Set<string>();
  const slots: ToolbarSlot[] = groups.map((g) => {
    const members: ToolSlotMember[] = g.members.map((m) => {
      const tool = index.get(m.id) ?? null;
      if (tool) placed.add(tool.id);
      return { ...m, tool, key: g.key };
    });
    // Tools that declare this group but aren't in the spec list join at the end.
    for (const t of tools) {
      if (t.group === g.id && !placed.has(t.id)) {
        placed.add(t.id);
        members.push({ id: t.id, name: t.flyoutLabel ?? toolLabel(t), tool: t, key: g.key, ...(t.glyph ? { glyph: t.glyph } : {}) });
      }
    }
    members.sort((a, b) => (a.tool?.groupOrder ?? g.members.findIndex((m) => m.id === a.id)) - (b.tool?.groupOrder ?? g.members.findIndex((m) => m.id === b.id)));
    return { id: g.id, key: g.key, tools: members.flatMap((m) => (m.tool ? [m.tool] : [])), members };
  });
  for (const t of tools) {
    if (placed.has(t.id)) continue;
    const key = t.shortcut.replace(/^shift\+/i, "").toUpperCase();
    slots.push({ id: t.group ?? t.id, key, tools: [t], members: [{ id: t.id, name: t.flyoutLabel ?? toolLabel(t), tool: t, key }] });
  }
  return slots;
}

/** "Move" → "Move Tool"; spec names win when the tool is in the spec. */
export function toolLabel(t: Pick<Tool, "id" | "name" | "flyoutLabel">): string {
  if (t.flyoutLabel) return t.flyoutLabel;
  for (const g of TOOL_GROUPS) {
    const m = g.members.find((x) => x.id === t.id);
    if (m) return m.name;
  }
  return /tool$/i.test(t.name) ? t.name : `${t.name} Tool`;
}

/** Glyph name for a tool id (spec glyph → tool.glyph → id). */
export function toolGlyph(id: string, tool?: Tool | null): string {
  for (const g of TOOL_GROUPS) {
    const m = g.members.find((x) => x.id === id);
    if (m?.glyph) return m.glyph;
  }
  return tool?.glyph ?? id;
}

/** The group a tool id belongs to (spec first, then the tool's own `group`). */
export function groupOfTool(id: string, tools: readonly Tool[] = TOOLS): string | null {
  for (const g of TOOL_GROUPS) if (g.members.some((m) => m.id === id)) return g.id;
  return tools.find((t) => t.id === id)?.group ?? null;
}

setGroupResolver((id) => groupOfTool(id));

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
