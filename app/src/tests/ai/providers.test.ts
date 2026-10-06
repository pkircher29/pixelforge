import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { KIND_FALLBACK, newCustomProvider, providersStore, slugify } from "../../lib/ai/providers.svelte";
import { aiUi } from "../../lib/ai/ui.svelte";
import { mkCustom, mkProvider } from "./fixtures";

const kinds = KIND_FALLBACK.map((k) => ({ ...k }));
const ollama = mkProvider("custom:ollama", { kind: "ollama", capabilities: { ...mkProvider("x_ai").capabilities, generate: false, instructEdit: false }, promptAssist: true, icon: "assist" });
const list = [mkProvider("open_ai", { hasKey: false }), mkProvider("x_ai"), mkProvider("custom:comfy"), ollama];

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "ai_list_providers":
        return list;
      case "ai_custom_list":
        return [mkCustom("comfy"), mkCustom("ollama", { kind: "ollama", model: "llava" })];
      case "ai_custom_kinds":
        return kinds;
      case "ai_custom_add":
        return [mkCustom("comfy"), mkCustom("ollama", { kind: "ollama" }), args?.provider as ReturnType<typeof mkCustom>];
      case "ai_custom_update":
        return [args?.provider as ReturnType<typeof mkCustom>];
      case "ai_custom_remove":
        return [mkCustom("ollama", { kind: "ollama" })];
      case "ai_custom_probe":
        return { reachable: true, models: ["a.safetensors", "b.ckpt"], message: "ok", authFailed: false };
      default:
        return null;
    }
  });
});
afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
});

describe("providersStore", () => {
  it("refresh loads the registry, the kind table and the provider list", async () => {
    await providersStore.refresh();
    expect(invoke).toHaveBeenCalledWith("ai_custom_list");
    expect(invoke).toHaveBeenCalledWith("ai_custom_kinds");
    expect(invoke).toHaveBeenCalledWith("ai_list_providers");
    expect(providersStore.custom.map((c) => c.id)).toEqual(["comfy", "ollama"]);
    expect(providersStore.kinds).toHaveLength(6);
    expect(providersStore.loaded).toBe(true);
    expect(aiUi.providers).toHaveLength(4);
  });

  it("derived views: generators exclude Ollama, assistants are the Ollama entries, ready needs a key or key-optional", async () => {
    await providersStore.refresh();
    expect(providersStore.generators.map((p) => p.id)).toEqual(["open_ai", "x_ai", "custom:comfy"]);
    expect(providersStore.assistants.map((p) => p.id)).toEqual(["custom:ollama"]);
    expect(providersStore.ready.map((p) => p.id)).toEqual(["x_ai", "custom:comfy"]);
    expect(providersStore.byId("custom:comfy")?.local).toBe(true);
    expect(providersStore.kindInfo("a1111").label).toMatch(/WebUI/);
  });

  it("add sends the entry and null auth when the secret is blank, then refreshes", async () => {
    const draft = mkCustom("new-one");
    const out = await providersStore.add(draft, "   ");
    expect(invoke).toHaveBeenCalledWith("ai_custom_add", { provider: draft, auth: null });
    expect(out).toHaveLength(3);
    expect(providersStore.custom.some((c) => c.id === "new-one")).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith("ai_list_providers");
  });

  it("update forwards the secret and clearAuth; remove drops the entry and its probe", async () => {
    const entry = mkCustom("comfy", { name: "Renamed" });
    await providersStore.update(entry, "tok", true);
    expect(invoke).toHaveBeenCalledWith("ai_custom_update", { provider: entry, auth: "tok", clearAuth: true });
    expect(providersStore.custom[0]?.name).toBe("Renamed");

    await providersStore.probe(mkCustom("comfy"));
    expect(providersStore.probes.comfy?.models).toEqual(["a.safetensors", "b.ckpt"]);
    await providersStore.remove("comfy");
    expect(invoke).toHaveBeenCalledWith("ai_custom_remove", { id: "comfy" });
    expect(providersStore.probes.comfy).toBeUndefined();
    expect(providersStore.custom.map((c) => c.id)).toEqual(["ollama"]);
  });

  it("probe works on unsaved drafts (no id) without remembering a result", async () => {
    const r = await providersStore.probe({ ...mkCustom(""), id: "" }, "abc");
    expect(r.reachable).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ai_custom_probe", { provider: expect.objectContaining({ id: "" }), auth: "abc" });
    expect(providersStore.probes[""]).toBeUndefined();
  });

  it("newCustomProvider takes the kind defaults; slugify makes unique ids", () => {
    const p = newCustomProvider("a1111");
    expect(p.baseUrl).toBe("http://127.0.0.1:7860");
    expect(p.capabilities.maskEdit).toBe(true);
    expect(p.kind).toBe("a1111");
    const o = newCustomProvider("ollama");
    expect(o.capabilities.generate).toBe(false);
    expect(slugify("My ComfyUI!")).toBe("my-comfyui");
    expect(slugify("My ComfyUI", ["my-comfyui"])).toBe("my-comfyui-2");
    expect(slugify("   ")).toBe("provider");
  });

  it("a failing IPC call leaves an error message instead of throwing out of refresh", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_custom_list") throw { code: "json", message: "registry corrupt" };
      return cmd === "ai_list_providers" ? list : [];
    });
    await providersStore.refresh();
    expect(providersStore.error).toBeTruthy();
    expect(providersStore.loaded).toBe(true);
  });
});
