import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, ProviderInfo } from "../../lib/ai/types";

type Handler = (e: { payload: JobEvent }) => void;
const handlers: Handler[] = [];
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, cb: Handler) => {
    handlers.push(cb);
    return () => {
      const i = handlers.indexOf(cb);
      if (i >= 0) handlers.splice(i, 1);
    };
  },
}));
// jsdom has no canvas: stand in for the PNG helpers with tiny deterministic rasters.
vi.mock("../../lib/ai/png", async () => {
  const { Raster } = await import("../../lib/engine");
  return {
    encodePng: async (r: InstanceType<typeof Raster>) => new Uint8Array([r.width, r.height]),
    decodeImage: async () => Raster.filled(4, 4, { r: 10, g: 20, b: 30, a: 255 }),
    thumbnailDataUrl: async () => "data:image/png;base64,QUJD",
    coverageToLumaRaster: (cov: Uint8Array, w: number, h: number) => {
      const r = new Raster(w, h);
      for (let i = 0; i < cov.length; i++) r.data[i * 4 + 3] = 255;
      return r;
    },
  };
});

import { encodeFrame, decodeFrame } from "../../lib/io/frame";
import { Rect, Selection, findLayer } from "../../lib/engine";
import { docStore } from "../../lib/stores/doc.svelte";
import { jobStore } from "../../lib/ai/jobs.svelte";
import { getHistory } from "../../lib/ai/history";
import { runAi, type AiRunRequest } from "../../lib/ai/run";

const grok: ProviderInfo = {
  id: "x_ai",
  name: "Grok",
  vendor: "xAI",
  hasKey: true,
  keyBackend: "file",
  kind: "builtin",
  local: false,
  icon: "cloud",
  promptAssist: false,
  keyOptional: false,
  defaultModel: "grok-imagine-image-2.0",
  editModel: "grok-imagine-image-2.0",
  models: ["grok-imagine-image-2.0"],
  capabilities: {
    generate: true,
    maskEdit: false,
    instructEdit: true,
    multiRef: true,
    maxRefs: 5,
    sizes: [],
    customSizes: false,
    aspectRatios: ["1:1"],
    resolutions: ["1k"],
    maxPx: 2048,
    maxVariants: 4,
    transparentBg: false,
    models: ["grok-imagine-image-2.0"],
  },
};

const meta = { width: 4, height: 4, provider: "x_ai" as const, model: "grok-imagine-image-2.0", mime: "image/png" as const, bytes: 2 };

function emit(ev: JobEvent): void {
  for (const h of [...handlers]) h({ payload: ev });
}

function request(over: Partial<AiRunRequest> = {}): AiRunRequest {
  return { provider: grok, model: grok.defaultModel, prompt: "red fox", n: 1, refs: [], newDocument: false, feather: 2, ...over };
}

let seq = 0;
it("Generative Fill keeps three masked results together in one undoable group", async () => {
  const open = docStore.create({ width: 16, height: 16, background: "white" });
  open.doc.selection = Selection.fromRect(16, 16, Rect.make(4, 4, 4, 4));
  const results = [meta, meta, meta];
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "ai_submit_edit") {
      const id = `J${++seq}`;
      queueMicrotask(() => emit({ job: id, provider: "x_ai", type: "completed", results, durationMs: 42 }));
      return id;
    }
    if (cmd === "ai_take_result") return encodeFrame({ results }, results.map(() => new Uint8Array([4, 4]))).buffer;
    return null;
  });
  const before = open.doc.layers.length;
  const run = await runAi(request({ forcedMode: "mask", n: 3, generativeFill: true, feather: 0 }));
  expect(run.job.applied).toEqual([0, 1, 2]);
  expect(open.doc.layers).toHaveLength(before + 4);
  const group = open.doc.layers.find((l) => l.kind === "group");
  if (group?.kind !== "group") throw new Error("Missing generative group");
  expect(group.generative?.variantIds).toHaveLength(3);
  const variants = open.doc.layers.filter((l) => l.parentId === group.id);
  expect(variants.map((l) => l.visible)).toEqual([true, false, false]);
  for (const l of variants) {
    expect(l.raster!.getPixel(0, 0).a).toBe(0);
    expect(l.raster!.getPixel(5, 5).a).toBe(255);
  }
  open.history.undo();
  expect(open.doc.layers).toHaveLength(before);
  expect(invoke.mock.calls.filter(([cmd]) => cmd === "ai_submit_generate")).toHaveLength(0);
});

it("rejects Generative Fill without a partial selection before submitting", async () => {
  docStore.create({ width: 16, height: 16, background: "white" });
  await expect(runAi(request({ forcedMode: "mask", n: 3, generativeFill: true }))).rejects.toThrow("partial selection");
  expect(invoke.mock.calls.filter(([cmd]) => cmd === "ai_submit_edit" || cmd === "ai_submit_generate")).toHaveLength(0);
});

it("does not install an incomplete Generative Fill group when a provider returns one result", async () => {
  const open = docStore.create({ width: 16, height: 16, background: "white" });
  open.doc.selection = Selection.fromRect(16, 16, Rect.make(4, 4, 4, 4));
  const before = open.doc.layers.length;
  await expect(runAi(request({ forcedMode: "mask", n: 3, generativeFill: true }))).rejects.toThrow("all three");
  expect(open.doc.layers).toHaveLength(before);
});

beforeEach(() => {
  invoke.mockReset();
  handlers.length = 0;
  jobStore.dispose();
  for (const d of [...docStore.docs]) docStore.close(d.id);
  // Every submit succeeds and completes immediately; the result is a 4x4 PNG stand-in.
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "ai_submit_generate" || cmd === "ai_submit_edit") {
      const id = `J${++seq}`;
      queueMicrotask(() => {
        emit({ job: id, provider: "x_ai", type: "started" });
        emit({ job: id, provider: "x_ai", type: "completed", results: [meta], durationMs: 42 });
      });
      return id;
    }
    if (cmd === "ai_take_result") return encodeFrame({ results: [meta] }, [new Uint8Array([4, 4])]).buffer;
    return null;
  });
});
afterEach(() => jobStore.dispose());

describe("runAi end to end (mocked IPC)", () => {
  it.each(["generate", "instruct"] as const)("sends sampling overrides through %s and retains them in history", async (forcedMode) => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    const provider: ProviderInfo = { ...grok, id: "custom:sd", kind: "a1111" };
    await runAi(request({ provider, forcedMode, seed: 0, steps: 27 }));
    const call = invoke.mock.calls.find(([cmd]) => cmd === (forcedMode === "generate" ? "ai_submit_generate" : "ai_submit_edit"))!;
    const sent = forcedMode === "generate" ? (call[1] as { params: unknown }).params : decodeFrame(call[1] as Uint8Array).header;
    expect(sent).toMatchObject({ seed: 0, steps: 27 });
    expect(getHistory(open.doc)[0]).toMatchObject({ seed: 0, steps: 27 });
  });

  it("rejects unsupported or invalid sampling before IPC or history changes", async () => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    await expect(runAi(request({ seed: 4 }))).rejects.toThrow("does not support");
    await expect(runAi(request({ provider: { ...grok, kind: "a1111", id: "custom:sd" }, steps: 1.5 }))).rejects.toThrow("whole number");
    expect(invoke).not.toHaveBeenCalled();
    expect(getHistory(open.doc)).toEqual([]);
  });

  it("generate: adds a layer and finishes the history entry as completed with a thumbnail", async () => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    // A document with pixels and no selection resolves to an instruct edit; force generate.
    const run = await runAi(request({ forcedMode: "generate" }));
    expect(run.job.state).toBe("completed");
    const hist = getHistory(open.doc);
    expect(hist).toHaveLength(1);
    const e = hist[0]!;
    expect(e.status).toBe("completed");
    expect(e.durationMs).toBe(42);
    expect(e.mode).toBe("generate");
    expect(e.resultLayerIds).toHaveLength(1);
    expect(e.resultThumbs[0]).toMatch(/^data:/);
    const layer = findLayer(open.doc, e.resultLayerIds[0]!);
    expect(layer?.name).toBe("Grok: red fox");
    expect(open.doc.activeLayerId).toBe(layer!.id);
  });

  it("emulated mask edit: sends an instruct crop and records the crop rect", async () => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    open.doc.selection = Selection.fromRect(16, 16, Rect.make(4, 4, 8, 8));
    const run = await runAi(request({ prompt: "add a hat" }));
    expect(run.prepared.resolution.mode).toBe("mask");
    expect(run.prepared.resolution.emulated).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ai_submit_edit", expect.any(Uint8Array));
    const e = getHistory(open.doc)[0]!;
    expect(e.status).toBe("completed");
    expect(e.emulated).toBe(true);
    expect(e.maskRect).toBeDefined();
    expect(e.maskThumb).toMatch(/^data:/);
    expect(e.resultLayerIds).toHaveLength(1);
  });

  it("a failed job leaves a failed entry with the typed error and no layer", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_submit_generate" || cmd === "ai_submit_edit") {
        queueMicrotask(() => emit({ job: "JF", provider: "x_ai", type: "failed", code: "ai_rate_limited", message: "429; Retry-After: 7" }));
        return "JF";
      }
      return null;
    });
    const open = docStore.create({ width: 8, height: 8 });
    const before = open.doc.layers.length;
    const run = await runAi(request({ forcedMode: "generate" }));
    expect(run.job.state).toBe("failed");
    const e = getHistory(open.doc)[0]!;
    expect(e.status).toBe("failed");
    expect(e.error?.code).toBe("ai_rate_limited");
    expect(open.doc.layers).toHaveLength(before);
  });
});
