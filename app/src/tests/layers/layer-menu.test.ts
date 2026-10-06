/**
 * Layer menu: structure (PS order), command enablement and `checked` against a
 * real document in the doc store. Imports the command module, which registers into
 * the registry at import time.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getCommand, getCommands } from "../../lib/ui/registry.svelte";
import { buildMenus } from "../../lib/ui/menu";
import { docStore } from "../../lib/stores/doc.svelte";
import { layersUi } from "../../lib/ui/panels/Layers.store.svelte";
import "../../lib/ui/commands/layer";
import { LAYERS_PANEL_MENU_IDS, ADJUSTMENT_MENU, FILL_MENU } from "../../lib/ui/commands/layer";
import { sampleDoc, byName, names } from "./fixtures";

function open() {
  const doc = sampleDoc();
  const entry = docStore.open(doc, null);
  layersUi.bind(entry.id);
  layersUi.setSelection([]);
  return doc;
}

const enabled = (id: string) => {
  const c = getCommand(id);
  if (!c) throw new Error(`no command ${id}`);
  return c.enabled ? c.enabled() : true;
};

beforeEach(() => {
  for (const d of docStore.docs.slice()) docStore.close(d.id);
});

describe("Layer menu", () => {
  it("has the PS submenus in order: New, Delete, Layer Style, New Fill Layer, New Adjustment Layer, Layer Mask, Rasterize, Arrange, Align, Distribute, Matting", () => {
    const layer = buildMenus(getCommands()).find((m) => m.label === "Layer")!;
    const subs = layer.children.filter((n) => n.type === "submenu").map((n) => (n.type === "submenu" ? n.label : ""));
    expect(subs).toEqual(["New", "Delete", "Layer Style", "New Fill Layer", "New Adjustment Layer", "Layer Mask", "Rasterize", "Arrange", "Align", "Distribute", "Matting"]);
    const top = layer.children.filter((n) => n.type === "item").map((n) => (n.type === "item" ? n.command.label : ""));
    expect(top).toEqual(["Duplicate Layer…", "Rename Layer…", "Vector Mask", "Create Clipping Mask", "Group Layers", "Ungroup Layers", "Hide Layers", "Lock Layers…", "Link Layers", "Select Linked Layers", "Merge Down", "Merge Visible", "Flatten Image"]);
    const nw = layer.children.find((n) => n.type === "submenu" && n.label === "New")!;
    expect(nw.type === "submenu" ? nw.children.filter((c) => c.type === "item").map((c) => (c.type === "item" ? c.command.label : "")) : []).toEqual(["Layer…", "Layer from Background…", "Group…", "Group from Layers…", "Layer Via Copy", "Layer Via Cut"]);
  });

  it("keeps the v0.1 ids and PS shortcuts", () => {
    for (const id of ["layer.new", "layer.duplicate", "layer.delete", "layer.properties", "layer.group", "layer.ungroup", "layer.mergeDown", "layer.mergeVisible", "layer.flatten", "layer.flipH", "layer.rotateCW", "layer.toggleVisible", "layer.toggleLock", "layer.bringForward", "layer.sendToBack"]) {
      expect(getCommand(id), id).toBeDefined();
    }
    expect(getCommand("layer.viaCopy")!.shortcut).toBe("CmdOrCtrl+J");
    expect(getCommand("layer.clipping")!.shortcut).toBe("CmdOrCtrl+Alt+G");
    expect(getCommand("layer.hide")!.shortcut).toBe("CmdOrCtrl+,");
    expect(getCommand("layer.mergeVisible")!.shortcut).toBe("CmdOrCtrl+Shift+E");
    expect(getCommand("layer.bringToFront")!.shortcut).toBe("CmdOrCtrl+Shift+]");
    expect(ADJUSTMENT_MENU.map((a) => a.label)).toContain("Levels…");
    expect(FILL_MENU.map((f) => f.label)).toEqual(["Solid Color…", "Gradient…", "Pattern…"]);
    for (const id of LAYERS_PANEL_MENU_IDS) expect(getCommand(id), id).toBeDefined();
  });

  it("is disabled without a document and enabled per layer kind with one", () => {
    expect(enabled("layer.new")).toBe(false);
    expect(enabled("layer.mergeDown")).toBe(false);
    const doc = open();
    // Active = Title (text with effects) above Shape 1.
    expect(enabled("layer.new")).toBe(true);
    expect(enabled("layer.rasterize.type")).toBe(true);
    expect(enabled("layer.rasterize.shape")).toBe(false);
    expect(enabled("layer.mergeDown")).toBe(true);
    expect(enabled("layer.style")).toBe(true);
    expect(enabled("layer.style.copy")).toBe(true);
    expect(enabled("layer.style.scale")).toBe(true);
    expect(enabled("layer.mask.revealAll")).toBe(true);
    expect(enabled("layer.mask.revealSelection")).toBe(false); // no selection
    expect(enabled("layer.mask.delete")).toBe(false);
    expect(enabled("layer.viaCut")).toBe(false);
    expect(enabled("layer.fromBackground")).toBe(false);
    expect(enabled("layer.link")).toBe(false);
    expect(enabled("layer.distribute.h")).toBe(false);
    expect(enabled("layer.vectorMask")).toBe(false);
    // Switch to the adjustment layer: mask commands flip.
    docStore.setActiveLayer(byName(doc, "Tint").id);
    expect(enabled("layer.mask.revealAll")).toBe(false);
    expect(enabled("layer.mask.delete")).toBe(true);
    expect(enabled("layer.mask.apply")).toBe(false); // no pixels to apply to
    expect(enabled("layer.rasterize.layer")).toBe(false);
    expect(enabled("layer.editAdjustment")).toBe(true);
    expect(enabled("layer.ungroup")).toBe(true);
    // Background: Layer from Background.
    docStore.setActiveLayer(byName(doc, "Background").id);
    expect(enabled("layer.fromBackground")).toBe(true);
    expect(enabled("layer.mergeDown")).toBe(false);
    // Group: no Blending Options.
    docStore.setActiveLayer(byName(doc, "Group 1").id);
    expect(enabled("layer.style")).toBe(false);
    expect(enabled("layer.group")).toBe(false);
  });

  it("checked marks: Create Clipping Mask ✓ on clipped layers, Disable mask ✓ when disabled", () => {
    const doc = open();
    docStore.setActiveLayer(byName(doc, "Tint").id);
    expect(getCommand("layer.clipping")!.checked!()).toBe(true);
    expect(getCommand("layer.mask.toggle")!.checked!()).toBe(false);
    byName(doc, "Tint").maskEnabled = false;
    expect(getCommand("layer.mask.toggle")!.checked!()).toBe(true);
    docStore.setActiveLayer(byName(doc, "Title").id);
    expect(getCommand("layer.clipping")!.checked!()).toBe(false);
  });

  it("multi-selection drives Link / Distribute / Delete enablement", () => {
    const doc = open();
    layersUi.setSelection([byName(doc, "Photo").id, byName(doc, "Shape 1").id]);
    expect(enabled("layer.link")).toBe(true);
    expect(enabled("layer.distribute.h")).toBe(true); // Photo, Shape 1, Title
    expect(enabled("layer.delete")).toBe(true);
    layersUi.setSelection(doc.layers.map((l) => l.id));
    expect(enabled("layer.delete")).toBe(false);
    expect(enabled("layer.group")).toBe(false); // includes a group and children
  });

  it("runs structural commands against the store document", async () => {
    const doc = open();
    await getCommand("layer.hide")!.run();
    expect(byName(doc, "Title").visible).toBe(false);
    await getCommand("layer.deleteHidden")!.run();
    expect(names(doc)).not.toContain("Title");
    docStore.setActiveLayer(byName(doc, "Shape 1").id);
    await getCommand("layer.rasterize.shape")!.run();
    expect(byName(doc, "Shape 1").kind).toBe("raster");
    await getCommand("layer.viaCopy")!.run();
    expect(doc.layers.length).toBe(6);
    expect(enabled("layer.mergeDown")).toBe(true);
    await getCommand("layer.mergeDown")!.run();
    expect(doc.layers.length).toBe(5);
    await getCommand("layer.flatten")!.run();
    expect(doc.layers.length).toBe(1);
  });
});
