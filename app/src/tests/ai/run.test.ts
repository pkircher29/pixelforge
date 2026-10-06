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

import { encodeFrame } from "../../lib/io/frame";
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
