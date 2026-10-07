import { beforeEach, describe, expect, it } from "vitest";
import { toolStore, rgbaToHex, hexToRgba } from "../lib/stores/tool.svelte";
import { ui } from "../lib/stores/ui.svelte";
import { toast, errorMessage } from "../lib/stores/toast.svelte";
import { docStore } from "../lib/stores/doc.svelte";
import { registerCommand, getCommand, runCommand, registerPanel, getPanels } from "../lib/ui/registry.svelte";
import { AddLayerCommand, SetLayerPropsCommand, createRasterLayer } from "../lib/engine";
import { reorderTarget } from "../lib/ui/panels/layer-reorder";
import { sampleThumb } from "../lib/ui/panels/thumbnail";
import { toolForKey, toolbarSlots, TOOLS, getTool } from "../lib/tools";

beforeEach(() => {
  localStorage.clear();
});

describe("tool store", () => {
  it("persists options per tool and falls back to defaults", () => {
    expect(toolStore.option("brush", "size", 24)).toBe(24);
    toolStore.setOption("brush", "size", 80);
    expect(toolStore.option("brush", "size", 24)).toBe(80);
    expect(toolStore.option("eraser", "size", 24)).toBe(24);
    const raw = JSON.parse(localStorage.getItem("pixelforge.tools.v1")!) as { options: Record<string, Record<string, unknown>> };
    expect(raw.options.brush?.size).toBe(80);
    toolStore.resetOptions("brush");
    expect(toolStore.option("brush", "size", 24)).toBe(24);
  });

  it("swaps and resets colours", () => {
    toolStore.setFg({ r: 10, g: 20, b: 30, a: 255 });
    toolStore.setBg({ r: 1, g: 2, b: 3, a: 255 });
    toolStore.swap();
    expect(toolStore.fg).toEqual({ r: 1, g: 2, b: 3, a: 255 });
    expect(toolStore.bg).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    toolStore.resetColors();
    expect(toolStore.fg).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(toolStore.bg).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("temp tool overrides the active tool", () => {
    toolStore.setActive("brush");
    toolStore.tempToolId = "hand";
    expect(toolStore.effectiveToolId).toBe("hand");
    toolStore.tempToolId = null;
    expect(toolStore.effectiveToolId).toBe("brush");
  });

  it("converts hex ↔ rgba", () => {
    expect(rgbaToHex({ r: 255, g: 0, b: 128, a: 255 })).toBe("#ff0080");
    expect(hexToRgba("#FF0080")).toEqual({ r: 255, g: 0, b: 128, a: 255 });
    expect(hexToRgba("nope")).toBeNull();
  });
});

describe("ui store", () => {
  it("toggles panel visibility and resets layout", () => {
    expect(ui.isPanelVisible("layers")).toBe(true);
    ui.togglePanel("layers");
    expect(ui.isPanelVisible("layers")).toBe(false);
    ui.setDockWidth(999);
    expect(ui.dockWidth).toBe(600);
    ui.resetLayout();
    expect(ui.isPanelVisible("layers")).toBe(true);
    expect(ui.dockWidth).toBe(280);
  });

  it("creates panel layouts lazily with defaults", () => {
    const p = ui.panel("scratch-panel", { weight: 2, collapsed: true });
    expect(p).toEqual({ weight: 2, collapsed: true });
    ui.setPanel("scratch-panel", { collapsed: false }, { weight: 2, collapsed: true });
    expect(ui.panel("scratch-panel").collapsed).toBe(false);
  });
});

describe("toast store", () => {
  it("pushes, caps and dismisses", () => {
    toast.clear();
    for (let i = 0; i < 7; i++) toast.info(`m${i}`);
    expect(toast.items.length).toBe(5);
    const id = toast.error("boom", "detail");
    expect(toast.items.find((t) => t.id === id)?.detail).toBe("detail");
    toast.dismiss(id);
    expect(toast.items.some((t) => t.id === id)).toBe(false);
    toast.clear();
  });

  it("formats IPC errors", () => {
    expect(errorMessage({ code: "io_decode", message: "bad png" })).toBe("bad png (io_decode)");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(new Error("E"))).toBe("E");
  });
});

describe("doc store", () => {
  it("bumps version/pixelVersion through exec and supports undo/redo + cycling", () => {
    const a = docStore.create({ name: "A", width: 8, height: 8 });
    const b = docStore.create({ name: "B", width: 8, height: 8 });
    expect(docStore.activeId).toBe(b.id);
    const v0 = b.version;
    docStore.exec(new AddLayerCommand(createRasterLayer(b.doc)));
    expect(b.version).toBe(v0 + 1);
    expect(b.pixelVersion).toBe(1);
    expect(b.dirty).toBe(true);
    expect(b.doc.layers).toHaveLength(2);
    docStore.undo();
    expect(b.doc.layers).toHaveLength(1);
    docStore.redo();
    expect(b.doc.layers).toHaveLength(2);
    docStore.touch();
    expect(b.pixelVersion).toBe(3);
    docStore.cycle(1);
    expect(docStore.activeId).toBe(a.id);
    docStore.cycle(-1);
    expect(docStore.activeId).toBe(b.id);
    docStore.close(a.id);
    docStore.close(b.id);
    expect(docStore.docs).toHaveLength(0);
    expect(docStore.activeId).toBeNull();
  });

  it("merges consecutive offset changes into one history entry", () => {
    const e = docStore.create({ name: "M", width: 8, height: 8 });
    const id = e.doc.activeLayerId!;
    docStore.exec(new SetLayerPropsCommand(id, { offset: { x: 1, y: 0 } }));
    docStore.exec(new SetLayerPropsCommand(id, { offset: { x: 2, y: 0 } }));
    docStore.exec(new SetLayerPropsCommand(id, { offset: { x: 3, y: 0 } }));
    expect(e.history.entries).toHaveLength(1);
    docStore.undo();
    expect(e.doc.layers[0]!.offset.x).toBe(0);
    docStore.close(e.id);
  });
});

describe("registry", () => {
  it("registers, replaces and runs commands honouring enabled()", async () => {
    let n = 0;
    registerCommand({ id: "t.one", label: "One", run: () => void n++ });
    registerCommand({ id: "t.one", label: "One again", run: () => void (n += 10) });
    expect(getCommand("t.one")?.label).toBe("One again");
    expect(await runCommand("t.one")).toBe(true);
    expect(n).toBe(10);
    registerCommand({ id: "t.off", label: "Off", enabled: () => false, run: () => void n++ });
    expect(await runCommand("t.off")).toBe(false);
    expect(await runCommand("t.missing")).toBe(false);
  });

  it("sorts panels by order within a dock", () => {
    const C = (() => {}) as unknown as import("svelte").Component;
    registerPanel({ id: "p.b", title: "B", dock: "right", order: 20, component: C });
    registerPanel({ id: "p.a", title: "A", dock: "right", order: 10, component: C });
    registerPanel({ id: "p.l", title: "L", dock: "left", order: 1, component: C });
    const right = getPanels("right").map((p) => p.id);
    expect(right.indexOf("p.a")).toBeLessThan(right.indexOf("p.b"));
    expect(right).not.toContain("p.l");
  });
});

describe("layer reorder math", () => {
  // engine indices: [0 bg, 1 mid, 2 top]
  it("moves a layer above / below a target accounting for removal", () => {
    expect(reorderTarget(0, 2, true)).toBe(2); // bg to the very top
    expect(reorderTarget(0, 2, false)).toBe(1); // bg just below top
    expect(reorderTarget(2, 0, false)).toBe(0); // top to the very bottom
    expect(reorderTarget(2, 0, true)).toBe(1); // top just above bg
    expect(reorderTarget(1, 1, true)).toBe(1);
  });

  it("accounts for group block length", () => {
    // [0 bg, 1 group, 2 child, 3 top]; move group block (len 2) above top
    expect(reorderTarget(1, 3, true, 2)).toBe(2);
  });
});

describe("thumbnails", () => {
  it("samples a layer into the thumb with document placement", () => {
    const doc = { width: 44, height: 32 };
    const l = createRasterLayer({ ...doc, layers: [] } as unknown as import("../lib/engine").Document, { name: "T" });
    l.raster.fill({ r: 255, g: 0, b: 0, a: 255 });
    const out = new Uint8ClampedArray(44 * 32 * 4);
    sampleThumb(l, doc.width, doc.height, out);
    expect(out[0]).toBe(255);
    expect(out[3]).toBe(255);
    // Offset layer leaves the left half transparent.
    l.offset = { x: 22, y: 0 };
    sampleThumb(l, doc.width, doc.height, out);
    expect(out[3]).toBe(0);
    expect(out[(0 * 44 + 30) * 4 + 3]).toBe(255);
  });
});

describe("tool registry", () => {
  it("has every PLAN tool with unique ids and shortcuts resolving", () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["move", "marquee-rect", "marquee-ellipse", "lasso", "lasso-polygon", "wand", "crop", "eyedropper", "brush", "eraser", "bucket", "gradient", "clone", "text", "zoom", "hand"]) {
      expect(getTool(id)).toBeDefined();
    }
  });

  it("groups fly-out tools into shared slots", () => {
    const slots = toolbarSlots();
    const marquee = slots.find((s) => s.id === "marquee")!;
    expect(marquee.tools.map((t) => t.id)).toEqual(["marquee-rect", "marquee-ellipse", "marquee-row", "marquee-column"]);
    expect(slots.find((s) => s.id === "gradient")!.tools.map((t) => t.id)).toEqual(["gradient", "bucket"]);
    expect(slots.filter((s) => s.tools.length > 0).length).toBeLessThan(TOOLS.length);
  });

  it("resolves keys and cycles within a group", () => {
    const k = (key: string, shift = false) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: shift });
    expect(toolForKey(k("v"), "brush")?.id).toBe("move");
    expect(toolForKey(k("m"), "move")?.id).toBe("marquee-rect");
    expect(toolForKey(k("m"), "marquee-rect")?.id).toBe("marquee-ellipse");
    expect(toolForKey(k("m"), "marquee-column")?.id).toBe("marquee-rect");
    // PS: G selects the Gradient tool first, pressing again cycles to the Paint Bucket.
    expect(toolForKey(k("g"), "move")?.id).toBe("gradient");
    expect(toolForKey(k("g"), "gradient")?.id).toBe("bucket");
    expect(toolForKey({ ...k("v"), ctrlKey: true }, "move")).toBeNull();
    expect(toolForKey(k("q"), "move")).toBeNull();
  });

  it("wand options plumb through to the schema defaults", () => {
    const wand = getTool("wand")!;
    const tol = wand.options.find((o) => o.key === "tolerance");
    expect(tol && tol.kind === "number" ? tol.default : null).toBe(32);
    expect(wand.options.some((o) => o.key === "contiguous" && o.kind === "toggle")).toBe(true);
    expect(wand.options.some((o) => o.key === "sampleMerged" && o.kind === "toggle")).toBe(true);
  });
});
