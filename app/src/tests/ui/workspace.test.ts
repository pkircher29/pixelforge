import { beforeEach, describe, expect, it } from "vitest";
import { ui, essentialsWorkspace, defaultGroupFor, DEFAULT_DOCK_WIDTH } from "../../lib/stores/ui.svelte";

beforeEach(() => {
  localStorage.clear();
  ui.resetWorkspace();
});

describe("workspace store (tab groups)", () => {
  it("starts as Essentials: color / properties / layers / history groups", () => {
    const w = essentialsWorkspace();
    expect(w.groups.map((g) => g.id)).toEqual(["color", "navigator", "properties", "layers", "history"]);
    expect(w.groups.find((g) => g.id === "layers")!.panels).toEqual(["layers", "channels", "paths"]);
    expect(w.groups.find((g) => g.id === "history")!.panels).toEqual(["history", "ai", "ai-history"]);
    expect(defaultGroupFor("swatches")).toBe("color");
    expect(defaultGroupFor("navigator")).toBe("navigator");
    expect(defaultGroupFor("brushes")).toBeNull();
  });

  it("places registered panels by hint, by the Essentials table, or in a new group", () => {
    ui.placePanel("channels", "layers");
    expect(ui.groupOf("channels")!.id).toBe("layers");
    ui.placePanel("ai", null);
    expect(ui.groupOf("ai")!.id).toBe("history");
    ui.placePanel("actions", null, 0.8);
    expect(ui.groupOf("actions")!.id).toBe("actions");
    expect(ui.groupOf("actions")!.weight).toBe(0.8);
    ui.placePanel("actions", "layers"); // idempotent: already placed
    expect(ui.groupOf("actions")!.id).toBe("actions");
  });

  it("activates a tab, un-hides it and expands its group", () => {
    ui.togglePanel("channels");
    ui.setGroupCollapsed("layers", true);
    ui.activateTab("channels");
    const g = ui.groupOf("channels")!;
    expect(g.active).toBe("channels");
    expect(g.collapsed).toBe(false);
    expect(ui.isPanelVisible("channels")).toBe(true);
  });

  it("collapses groups and the whole column", () => {
    ui.toggleGroupCollapsed("layers");
    expect(ui.groupOf("layers")!.collapsed).toBe(true);
    ui.toggleGroupCollapsed("layers");
    expect(ui.groupOf("layers")!.collapsed).toBe(false);
    ui.setIconized(true);
    expect(ui.workspace.iconized).toBe(true);
  });

  it("trades weight between adjacent groups within limits", () => {
    const a = ui.groupOf("layers")!;
    const b = ui.groupOf("history")!;
    const total = a.weight + b.weight;
    ui.setPairWeights("layers", "history", 0.75);
    expect(a.weight).toBeCloseTo(total * 0.75);
    expect(b.weight).toBeCloseTo(total * 0.25);
    ui.setPairWeights("layers", "history", 2);
    expect(a.weight / total).toBeCloseTo(0.92);
  });

  it("moves a tab between groups, into a new group, and drops empty groups", () => {
    ui.movePanel("paths", "history", 0);
    expect(ui.groupOf("paths")!.id).toBe("history");
    expect(ui.groupOf("paths")!.panels[0]).toBe("paths");
    expect(ui.groupOf("paths")!.active).toBe("paths");
    ui.movePanel("properties", null);
    const g = ui.groupOf("properties")!;
    expect(g.id).not.toBe("properties");
    expect(ui.workspace.groups.some((x) => x.id === "properties")).toBe(false);
    ui.movePanel("layers", "color", 1);
    expect(ui.groupOf("layers")!.panels).toEqual(["color", "layers", "swatches"]);
  });

  it("reorders within the same group", () => {
    ui.movePanel("channels", "layers", 0);
    expect(ui.groupOf("layers")!.panels).toEqual(["channels", "layers", "paths"]);
    ui.movePanel("channels", "layers", 3);
    expect(ui.groupOf("layers")!.panels).toEqual(["layers", "paths", "channels"]);
  });

  it("Window ▸ panel toggles hide and re-show, switching the active tab away from a hidden one", () => {
    ui.activateTab("layers");
    ui.togglePanel("layers");
    expect(ui.isPanelVisible("layers")).toBe(false);
    expect(ui.groupOf("layers")!.active).toBe("channels");
    ui.togglePanel("layers");
    expect(ui.isPanelVisible("layers")).toBe(true);
    expect(ui.groupOf("layers")!.active).toBe("layers");
  });

  it("persists and restores the workspace, dock width and rulers", () => {
    ui.movePanel("paths", "history", 0);
    ui.setDockWidth(333);
    ui.toggleRulers();
    ui.setStatusInfo("timing");
    const raw = JSON.parse(localStorage.getItem("pixelforge.ui.v2")!) as { workspace: { groups: { id: string; panels: string[] }[] }; dockWidth: number; showRulers: boolean; statusInfo: string };
    expect(raw.workspace.groups.find((g) => g.id === "history")!.panels[0]).toBe("paths");
    expect(raw.dockWidth).toBe(333);
    expect(raw.showRulers).toBe(true);
    expect(raw.statusInfo).toBe("timing");
    ui.resetWorkspace();
    expect(ui.dockWidth).toBe(DEFAULT_DOCK_WIDTH);
    expect(ui.groupOf("paths")!.id).toBe("layers");
  });

  it("keeps the legacy panel()/setPanel() API working against groups", () => {
    expect(ui.panel("layers").collapsed).toBe(false);
    ui.setPanel("layers", { collapsed: true });
    expect(ui.groupOf("layers")!.collapsed).toBe(true);
    const p = ui.panel("nowhere", { weight: 2, collapsed: true });
    expect(p).toEqual({ weight: 2, collapsed: true });
  });
});
