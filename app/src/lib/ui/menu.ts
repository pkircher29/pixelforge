/**
 * Build the menu-bar tree from the command registry (pure).
 *
 * Top-level menus are fixed and ordered; items are grouped by their `menu` path and
 * sorted by `order`; a separator is inserted whenever `floor(order / 100)` changes;
 * nested paths ("Image/Adjustments") become submenus placed at the position of the
 * smallest order inside them.
 */
import type { CommandDef } from "./registry.svelte";

export const TOP_MENUS = ["File", "Edit", "Image", "Layer", "Select", "Filter", "AI", "View", "Window", "Help"] as const;
export type TopMenu = (typeof TOP_MENUS)[number];

export type MenuNode =
  | { type: "item"; command: CommandDef; order: number }
  | { type: "submenu"; label: string; path: string; children: MenuNode[]; order: number }
  | { type: "separator" };

export interface MenuTree {
  label: string;
  children: MenuNode[];
}

interface Folder {
  label: string;
  path: string;
  items: { command: CommandDef; order: number }[];
  folders: Map<string, Folder>;
}

function folderFor(root: Folder, segments: string[]): Folder {
  let f = root;
  let path = root.path;
  for (const s of segments) {
    path = path ? `${path}/${s}` : s;
    let next = f.folders.get(s);
    if (!next) {
      next = { label: s, path, items: [], folders: new Map() };
      f.folders.set(s, next);
    }
    f = next;
  }
  return f;
}

function minOrder(f: Folder): number {
  let m = Infinity;
  for (const i of f.items) m = Math.min(m, i.order);
  for (const sub of f.folders.values()) m = Math.min(m, minOrder(sub));
  return m === Infinity ? 0 : m;
}

function flatten(f: Folder): MenuNode[] {
  const nodes: MenuNode[] = [
    ...f.items.map((i): MenuNode => ({ type: "item", command: i.command, order: i.order })),
    ...[...f.folders.values()].map(
      (sub): MenuNode => ({ type: "submenu", label: sub.label, path: sub.path, children: flatten(sub), order: minOrder(sub) }),
    ),
  ];
  nodes.sort((a, b) => (a.type === "separator" ? 0 : a.order) - (b.type === "separator" ? 0 : b.order));
  const out: MenuNode[] = [];
  let lastGroup: number | null = null;
  for (const n of nodes) {
    if (n.type === "separator") continue;
    const group = Math.floor(n.order / 100);
    if (lastGroup !== null && group !== lastGroup) out.push({ type: "separator" });
    out.push(n);
    lastGroup = group;
  }
  return out;
}

/** Menus in fixed order; empty menus are kept (rendered disabled) so the bar is stable. */
export function buildMenus(commands: readonly CommandDef[]): MenuTree[] {
  const roots = new Map<string, Folder>();
  for (const top of TOP_MENUS) roots.set(top, { label: top, path: top, items: [], folders: new Map() });
  for (const c of commands) {
    if (!c.menu) continue;
    const segs = c.menu.split("/").map((s) => s.trim()).filter(Boolean);
    const top = segs[0];
    if (!top) continue;
    let root = roots.get(top);
    if (!root) {
      // Unknown top-level: append after Help so nothing is lost.
      root = { label: top, path: top, items: [], folders: new Map() };
      roots.set(top, root);
    }
    const f = folderFor(root, segs.slice(1));
    f.items.push({ command: c, order: c.order ?? 1000 });
  }
  return [...roots.values()].map((r) => ({ label: r.label, children: flatten(r) }));
}
