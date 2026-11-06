import { afterEach, expect, it, vi } from "vitest";
import { settings } from "../../lib/stores/settings.svelte";

afterEach(() => vi.restoreAllMocks());

it("reports strict save failures and still permits a later retry", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("disk full"); });
  await expect(settings.set({ promptLibrary: [] }, { throwOnError: true })).rejects.toThrow("disk full");
  await expect(settings.set({ promptLibrary: [] }, { throwOnError: true })).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
});

it("exposes a settings-load failure so libraries cannot overwrite unread data", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("unavailable"); });
  await settings.load();
  expect(settings.loadError).toMatch(/Could not load/);
  await settings.load();
  expect(settings.loadError).toBeNull();
});
