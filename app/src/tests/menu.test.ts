import { describe, expect, it } from "vitest";
import { buildMenus, TOP_MENUS } from "../lib/ui/menu";
import { fuzzyMatch, scoreCommand } from "../lib/ui/fuzzy";
import type { CommandDef } from "../lib/ui/registry.svelte";

const cmd = (id: string, label: string, menu?: string, order?: number, shortcut?: string): CommandDef => {
  const c: CommandDef = { id, label, run: () => {} };
  if (menu) c.menu = menu;
  if (order !== undefined) c.order = order;
  if (shortcut) c.shortcut = shortcut;
  return c;
};

describe("buildMenus", () => {
  it("keeps the fixed top-level order even when menus are empty", () => {
    const menus = buildMenus([cmd("h.a", "About", "Help", 100)]);
    expect(menus.map((m) => m.label)).toEqual([...TOP_MENUS]);
    expect(menus.find((m) => m.label === "File")!.children).toHaveLength(0);
  });

  it("sorts items by order and inserts separators at hundreds", () => {
    const menus = buildMenus([
      cmd("f.save", "Save", "File", 200),
      cmd("f.new", "New", "File", 100),
      cmd("f.open", "Open", "File", 101),
      cmd("f.quit", "Quit", "File", 400),
    ]);
    const file = menus.find((m) => m.label === "File")!;
    const shape = file.children.map((n) => (n.type === "item" ? n.command.id : n.type));
    expect(shape).toEqual(["f.new", "f.open", "separator", "f.save", "separator", "f.quit"]);
  });

  it("builds nested submenus from slash paths at the position of their lowest order", () => {
    const menus = buildMenus([
      cmd("i.size", "Image Size", "Image", 100),
      cmd("i.adj.levels", "Levels", "Image/Adjustments", 210),
      cmd("i.adj.curves", "Curves", "Image/Adjustments", 205),
      cmd("i.rot", "Rotate", "Image", 300),
    ]);
    const image = menus.find((m) => m.label === "Image")!;
    expect(image.children.map((n) => n.type)).toEqual(["item", "separator", "submenu", "separator", "item"]);
    const sub = image.children[2]!;
    expect(sub.type).toBe("submenu");
    if (sub.type === "submenu") {
      expect(sub.label).toBe("Adjustments");
      expect(sub.path).toBe("Image/Adjustments");
      expect(sub.children.map((n) => (n.type === "item" ? n.command.id : n.type))).toEqual(["i.adj.curves", "i.adj.levels"]);
    }
  });

  it("ignores palette-only commands and tolerates unknown top menus", () => {
    const menus = buildMenus([cmd("x", "Hidden"), cmd("y", "Weird", "Plugins", 1)]);
    expect(menus.some((m) => m.label === "Plugins")).toBe(true);
    expect(menus.flatMap((m) => m.children).some((n) => n.type === "item" && n.command.id === "x")).toBe(false);
  });

  it("defaults order to 1000 so unordered items sink to the bottom", () => {
    const menus = buildMenus([cmd("a", "A", "Edit"), cmd("b", "B", "Edit", 100)]);
    const edit = menus.find((m) => m.label === "Edit")!;
    expect(edit.children[0]).toMatchObject({ type: "item", command: { id: "b" } });
  });
});

describe("fuzzy", () => {
  it("matches subsequences and rejects non-matches", () => {
    expect(fuzzyMatch("gb", "Gaussian Blur")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Gaussian Blur")).toBeNull();
    expect(fuzzyMatch("", "anything")?.score).toBe(0);
  });

  it("prefers word starts and consecutive runs", () => {
    const a = fuzzyMatch("sa", "Save As")!;
    const b = fuzzyMatch("sa", "Deselect all")!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.indices).toEqual([0, 1]);
  });

  it("scoreCommand searches keywords and menu path too", () => {
    const c: CommandDef = { id: "file.export", label: "Export as…", menu: "File", keywords: ["png", "jpeg"], run: () => {} };
    expect(scoreCommand("png", c)).not.toBeNull();
    expect(scoreCommand("file", c)).not.toBeNull();
    expect(scoreCommand("zzz", c)).toBeNull();
    // Label hits outrank keyword hits.
    expect(scoreCommand("export", c)!.score).toBeGreaterThan(scoreCommand("png", c)!.score);
  });
});
