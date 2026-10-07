import { beforeEach, describe, expect, it } from "vitest";
import { defaultGroups, defaultSwatches, PRIMARIES, HUE_NAMES } from "../../lib/ui/panels/swatch-defaults";
import { filterSwatches, parseSwatches, serializeSwatches, swatchStore } from "../../lib/ui/panels/Swatches.store.svelte";

beforeEach(() => {
  localStorage.clear();
  swatchStore.resetToDefault();
});

describe("default swatch set", () => {
  it("ships the classic Default grid: primaries, 5 hue families, grays, browns", () => {
    const d = defaultSwatches();
    expect(d).toHaveLength(15 + 5 * 16 + 16 + 10);
    expect(new Set(d.map((s) => s.name)).size).toBeGreaterThan(110);
  });

  it("starts with the RGB/CMYK primaries and has the PS CC folders", () => {
    expect(defaultSwatches()[0]).toEqual(PRIMARIES[0]);
    expect(defaultGroups().map((g) => g.name)).toEqual(["Pastel", "Light", "Pure", "Dark", "Darker", "Grayscale"]);
    const pure = defaultGroups().find((g) => g.name === "Pure")!;
    expect(pure.swatches).toHaveLength(HUE_NAMES.length);
    expect(pure.swatches[0]!.color).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe("swatch store", () => {
  it("adds and deletes swatches (loose and inside groups)", () => {
    const n = swatchStore.items.length;
    const s = swatchStore.add({ r: 1, g: 2, b: 3 }, "Mine");
    expect(swatchStore.items).toHaveLength(n + 1);
    expect(swatchStore.remove(s.id)).toBe(true);
    expect(swatchStore.items).toHaveLength(n);
    const g = swatchStore.addGroup("Brand");
    const inG = swatchStore.add({ r: 9, g: 9, b: 9 }, "Ink", g.id);
    expect(swatchStore.groups.find((x) => x.id === g.id)!.swatches.map((x) => x.id)).toEqual([inG.id]);
    expect(swatchStore.remove(inG.id)).toBe(true);
    expect(swatchStore.remove("nope")).toBe(false);
  });

  it("toggles groups, renames, switches thumbnail size", () => {
    const g = swatchStore.groups[0]!;
    const was = g.collapsed;
    swatchStore.toggleGroup(g.id);
    expect(swatchStore.groups[0]!.collapsed).toBe(!was);
    const s = swatchStore.items[0]!;
    swatchStore.rename(s.id, "Renamed");
    expect(swatchStore.items[0]!.name).toBe("Renamed");
    swatchStore.setThumb("large");
    expect(swatchStore.thumb).toBe("large");
  });

  it("exports and re-imports a set losslessly (names, colours, groups)", () => {
    swatchStore.addGroup("Brand");
    swatchStore.add({ r: 10, g: 20, b: 30 }, "Navy", swatchStore.groups.at(-1)!.id);
    const json = JSON.parse(swatchStore.exportJson());
    expect(json["pixelforge-swatches"]).toBe(1);
    const parsed = parseSwatches(json)!;
    expect(serializeSwatches(parsed)).toEqual(json);
  });

  it("rejects non-swatch files and drops malformed entries", () => {
    expect(parseSwatches(null)).toBeNull();
    expect(parseSwatches({ foo: 1 })).toBeNull();
    const p = parseSwatches({ items: [{ n: "ok", c: "#ff0000" }, { n: "bad", c: "red" }, 4] })!;
    expect(p.items.map((s) => s.name)).toEqual(["ok"]);
  });

  it("imports by appending and searches by name or hex", () => {
    const before = swatchStore.items.length;
    swatchStore.importSet(parseSwatches({ items: [{ n: "Teal Ink", c: "#008080" }], groups: [] })!, true);
    expect(swatchStore.items).toHaveLength(before + 1);
    expect(filterSwatches(swatchStore.items, "teal").map((s) => s.name)).toEqual(["Teal Ink"]);
    expect(filterSwatches(swatchStore.items, "#008080").map((s) => s.name)).toEqual(["Teal Ink"]);
    expect(filterSwatches(swatchStore.items, "").length).toBe(swatchStore.items.length);
  });
});
