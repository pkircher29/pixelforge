import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

beforeEach(() => { vi.resetModules(); native.invoke.mockReset(); native.isTauri.mockReturnValue(false); });
afterEach(() => vi.unstubAllGlobals());

describe("installed font discovery", () => {
  it("requests browser permission synchronously from the picker gesture", async () => {
    const query = vi.fn().mockResolvedValue([{ family: "Custom Face" }, { family: "Custom Face" }]);
    vi.stubGlobal("queryLocalFonts", query);
    const { listFonts } = await import("../lib/tools/fonts");
    const request = listFonts();
    expect(query).toHaveBeenCalledOnce();
    expect(await request).toEqual(["Custom Face"]);
    expect(await listFonts()).toEqual(["Custom Face"]);
    expect(query).toHaveBeenCalledOnce();
  });

  it("falls back to the native list when browser permission is denied", async () => {
    vi.stubGlobal("queryLocalFonts", vi.fn().mockRejectedValue(new Error("NotAllowedError")));
    native.isTauri.mockReturnValue(true);
    native.invoke.mockResolvedValue(["Zebra", "Custom Face", "Zebra", ""]);
    const { listFonts } = await import("../lib/tools/fonts");
    expect(await listFonts()).toEqual(["Custom Face", "Zebra"]);
    expect(native.invoke).toHaveBeenCalledWith("fonts_list");
  });

  it("retries failures and refreshes after fonts are installed", async () => {
    vi.stubGlobal("queryLocalFonts", undefined);
    native.isTauri.mockReturnValue(true);
    native.invoke.mockRejectedValueOnce(new Error("temporary"));
    const { listFonts, FALLBACK_FONTS } = await import("../lib/tools/fonts");
    expect(await listFonts()).toEqual(FALLBACK_FONTS);
    native.invoke.mockResolvedValueOnce(["First"]);
    expect(await listFonts()).toEqual(["First"]);
    native.invoke.mockResolvedValueOnce(["First", "New Font"]);
    expect(await listFonts(true)).toEqual(["First", "New Font"]);
  });
});
