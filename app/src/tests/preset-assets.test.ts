import { beforeEach, expect, it, vi } from "vitest";
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), files: new Map<string, unknown>() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: ipc.invoke }));

beforeEach(() => {
  vi.resetModules(); localStorage.clear(); ipc.files.clear();
  ipc.invoke.mockImplementation(async (command: string, args: { kind?: string; asset?: { id: string }; id?: string; settings?: unknown } = {}) => {
    if (command === "presets_list") return { assets: [...ipc.files.entries()].filter(([key]) => key.startsWith(`${args.kind}/`)).map(([, asset]) => structuredClone(asset)), errors: [] };
    if (command === "presets_save") { ipc.files.set(`${args.kind}/${args.asset!.id}`, structuredClone(args.asset)); return; }
    if (command === "presets_remove") { ipc.files.delete(`${args.kind}/${args.id}`); return; }
    if (command === "settings_set") return args.settings;
    throw new Error(`Unexpected command ${command}`);
  });
});

it("serializes rename updates and preserves another preset sharing a sampled tip", async () => {
  const assets = await import("../lib/tools/preset-assets");
  const { brushStore } = await import("../lib/tools/brush-store.svelte");
  const { tipFromRaster } = await import("../lib/tools/brush-tips");
  const { Raster } = await import("../lib/engine");
  await assets.hydratePresetAssets();
  tipFromRaster("sampled-test", "Test", Raster.filled(2, 2, { r: 0, g: 0, b: 0, a: 255 }));
  brushStore.update({ tip: "sampled-test" });
  const first = brushStore.saveAsPreset("First");
  brushStore.update({ size: 75 });
  const second = brushStore.saveAsPreset("Second");
  brushStore.renamePreset(first.id, "Renamed");
  await assets.flushBrushAssetWrites();
  let saved = (await assets.listPresetAssets("brushes")).assets[0]!;
  expect(assets.brushPresetsOf(saved).map(p => p.name)).toEqual(["Renamed", "Second"]);
  expect(assets.brushPresetsOf(saved)[1]!.settings.size).toBe(75);
  brushStore.deletePreset(first.id);
  await assets.flushBrushAssetWrites();
  saved = (await assets.listPresetAssets("brushes")).assets[0]!;
  expect(saved.name).toBe("Second");
  expect(assets.brushPresetsOf(saved).map(p => p.id)).toEqual([second.id]);
  brushStore.deletePreset(second.id);
  await assets.flushBrushAssetWrites();
  expect((await assets.listPresetAssets("brushes")).assets).toEqual([]);
});

it("restores saved tip pixels and all shared presets without local browser storage", async () => {
  const { DEFAULT_BRUSH_SETTINGS } = await import("../lib/tools/brush-engine");
  const primary = { id: "one", name: "One", group: "User Brushes", settings: { ...DEFAULT_BRUSH_SETTINGS, tip: "sampled-restored" } };
  const second = { ...primary, id: "two", name: "Two", settings: { ...primary.settings, size: 77 } };
  ipc.files.set("brushes/sampled-restored", { id: "sampled-restored", name: "One", width: 1, height: 1, pixels: [0, 0, 0, 128], settings: { ...primary, linkedPresets: [primary, second] } });
  const { hydratePresetAssets } = await import("../lib/tools/preset-assets");
  await hydratePresetAssets();
  const { brushStore } = await import("../lib/tools/brush-store.svelte");
  const { tipById } = await import("../lib/tools/brush-tips");
  expect(brushStore.userPresets.map(p => p.name)).toEqual(["One", "Two"]);
  expect(brushStore.userPresets[1]!.settings.size).toBe(77);
  expect(tipById("sampled-restored").raster!.data[3]).toBe(128);
});

it("deletes a shared asset after pending library saves without resurrecting it", async () => {
  const assets = await import("../lib/tools/preset-assets");
  const { brushStore } = await import("../lib/tools/brush-store.svelte");
  const { tipFromRaster } = await import("../lib/tools/brush-tips");
  const { Raster } = await import("../lib/engine");
  await assets.hydratePresetAssets();
  tipFromRaster("sampled-deleted", "Test", Raster.filled(1, 1, { r: 0, g: 0, b: 0, a: 255 }));
  brushStore.update({ tip: "sampled-deleted" });
  const first = brushStore.saveAsPreset("First");
  await assets.flushBrushAssetWrites();
  const asset = (await assets.listPresetAssets("brushes")).assets[0]!;
  brushStore.saveAsPreset("Second");
  brushStore.renamePreset(first.id, "Pending rename");
  await assets.deleteUserAsset("brushes", asset);
  expect((await assets.listPresetAssets("brushes")).assets).toEqual([]);
  expect(brushStore.userPresets).toEqual([]);
  expect(brushStore.settings.tip).toBe("round");
});
