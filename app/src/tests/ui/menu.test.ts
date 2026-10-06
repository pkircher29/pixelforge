import { describe, expect, it } from "vitest";
import { buildMenus, TOP_MENUS, hasCheckColumn, itemState } from "../../lib/ui/menu";
import type { CommandDef } from "../../lib/ui/registry.svelte";

const cmd = (id: string, label: string, menu: string, order: number, extra: Partial<CommandDef> = {}): CommandDef => ({ id, label, menu, order, run: () => {}, ...extra });

describe("menu bar (PS order + check marks)", () => {
  it("has the Photoshop top menus with Type after Layer", () => {
    expect([...TOP_MENUS]).toEqual(["File", "Edit", "Image", "Layer", "Type", "Select", "Filter", "AI", "View", "Window", "Help"]);
    expect(buildMenus([]).map((m) => m.label)).toEqual([...TOP_MENUS]);
  });

  it("renders `checked` toggles with a ✓ and reserves the column for siblings", () => {
    let on = true;
    const view = buildMenus([cmd("v.rulers", "Rulers", "View", 210, { checked: () => on }), cmd("v.fit", "Fit", "View", 100)]).find((m) => m.label === "View")!;
    expect(hasCheckColumn(view.children)).toBe(true);
    const rulers = view.children.find((n) => n.type === "item" && n.command.id === "v.rulers");
    expect(rulers && rulers.type === "item" ? itemState(rulers.command).checked : null).toBe(true);
    on = false;
    expect(rulers && rulers.type === "item" ? itemState(rulers.command).checked : null).toBe(false);
    const help = buildMenus([cmd("h.a", "About", "Help", 100)]).find((m) => m.label === "Help")!;
    expect(hasCheckColumn(help.children)).toBe(false);
  });

  it("reports disabled + checked together", () => {
    const st = itemState(cmd("x", "X", "Edit", 1, { enabled: () => false, checked: () => true }));
    expect(st).toEqual({ disabled: true, checked: true });
    expect(itemState(cmd("y", "Y", "Edit", 1))).toEqual({ disabled: false, checked: false });
  });

  it("puts Window ▸ panel toggles and Workspace submenu in the Window menu", () => {
    const menus = buildMenus([
      cmd("window.panel.layers", "Layers", "Window", 310, { checked: () => true }),
      cmd("window.resetLayout", "Reset Essentials", "Window/Workspace", 100),
    ]);
    const win = menus.find((m) => m.label === "Window")!;
    expect(win.children.map((n) => n.type)).toEqual(["submenu", "separator", "item"]);
  });
});
