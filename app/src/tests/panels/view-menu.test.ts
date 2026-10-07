import { beforeEach, describe, expect, it } from "vitest";
import { ui } from "../../lib/stores/ui.svelte";
import { toolStore } from "../../lib/stores/tool.svelte";
import { printSizeZoom, viewMenuCommands } from "../../lib/ui/commands/view";
import { viewExtras } from "../../lib/ui/commands/view-extras.svelte";
import { buildMenus } from "../../lib/ui/menu";

const cmd = (id: string) => viewMenuCommands().find((c) => c.id === id)!;

beforeEach(() => {
  localStorage.clear();
  ui.showSelectionEdges = true;
  ui.showPixelGrid = true;
  viewExtras.extras = true;
  viewExtras.grid = false;
  viewExtras.layerEdges = false;
  toolStore.screenMode = "standard";
});

describe("View menu", () => {
  it("follows Photoshop's order with Screen Mode and Show submenus", () => {
    const view = buildMenus(viewMenuCommands()).find((m) => m.label === "View")!;
    const shape = view.children.map((n) => (n.type === "item" ? n.command.label : n.type === "submenu" ? `${n.label} ▸` : "—"));
    expect(shape).toEqual(["Zoom In", "Zoom Out", "Fit on Screen", "100%", "200%", "Print Size", "—", "Screen Mode ▸", "—", "Extras", "Show ▸", "—", "Rulers", "—", "Snap"]);
  });

  it("screen mode items are radio-checked", () => {
    cmd("view.screen.full").run();
    expect(cmd("view.screen.full").checked!()).toBe(true);
    expect(cmd("view.screen.standard").checked!()).toBe(false);
    cmd("view.screen.standard").run();
    expect(toolStore.screenMode).toBe("standard");
  });

  it("Extras (Ctrl+H) hides every extra and restores them", () => {
    expect(cmd("view.extras").shortcut).toBe("CmdOrCtrl+H");
    cmd("view.extras").run();
    expect(cmd("view.extras").checked!()).toBe(false);
    expect(ui.showSelectionEdges).toBe(false);
    expect(ui.showPixelGrid).toBe(false);
    cmd("view.extras").run();
    expect(ui.showSelectionEdges).toBe(true);
    expect(ui.showPixelGrid).toBe(true);
  });

  it("Show ▸ toggles report their checked state; showing one re-enables Extras", () => {
    expect(cmd("view.grid").checked!()).toBe(false);
    cmd("view.extras").run();
    cmd("view.grid").run();
    expect(cmd("view.grid").checked!()).toBe(true);
    expect(viewExtras.extras).toBe(true);
    expect(viewExtras.visible("grid")).toBe(true);
    cmd("view.layerEdges").run();
    expect(cmd("view.layerEdges").checked!()).toBe(true);
    cmd("view.pixelGrid").run();
    expect(cmd("view.pixelGrid").checked!()).toBe(ui.showPixelGrid);
  });

  it("Rulers and Snap are check items; Print Size zooms to physical size", () => {
    const before = ui.showRulers;
    cmd("view.rulers").run();
    expect(cmd("view.rulers").checked!()).toBe(!before);
    const snap = viewExtras.snap;
    cmd("view.snap").run();
    expect(cmd("view.snap").checked!()).toBe(!snap);
    expect(printSizeZoom(96)).toBe(1);
    expect(printSizeZoom(300)).toBeCloseTo(0.32);
  });
});
