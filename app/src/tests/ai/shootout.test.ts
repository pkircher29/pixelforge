import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, ProviderId } from "../../lib/ai/types";

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

import { decodeFrame, encodeFrame } from "../../lib/io/frame";
import { Rect, Selection, findLayer } from "../../lib/engine";
import { docStore } from "../../lib/stores/doc.svelte";
import { settings } from "../../lib/stores/settings.svelte";
import { getHistory } from "../../lib/ai/history";
import { jobStore } from "../../lib/ai/jobs.svelte";
import { ShootoutSession, SHOOTOUT_EXCLUDED_KEY, cardKey, columnKeys, createShootout, setShootoutExcluded, shootoutExcluded, shootoutProviders, type ShootoutRequest } from "../../lib/ai/shootout";
import { mkProvider } from "./fixtures";

const openai = mkProvider("open_ai", { name: "ChatGPT", capabilities: { ...mkProvider("open_ai").capabilities, maskEdit: true } });
const grok = mkProvider("x_ai", { name: "Grok" });
const gemini = mkProvider("gemini", { name: "Gemini" });
const comfy = mkProvider("custom:comfy", { name: "My ComfyUI", capabilities: { ...mkProvider("custom:comfy").capabilities, maskEdit: true } });

function emit(ev: JobEvent): void {
  for (const h of [...handlers]) h({ payload: ev });
}

/** Every submit completes with `n` variants unless the provider is in `failing`. */
let failing = new Set<ProviderId>();
let submitted: { provider: ProviderId; mode: string; n: number }[] = [];
const jobN = new Map<string, number>();
let seq = 0;

function request(over: Partial<ShootoutRequest> = {}): ShootoutRequest {
  return { prompt: "red fox", n: 1, refs: [], feather: 2, ...over };
}

async function settle(session: ShootoutSession): Promise<void> {
  for (let i = 0; i < 200 && !session.done; i++) await new Promise((r) => setTimeout(r, 2));
  // Let the post-completion preview/history work finish.
  await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  invoke.mockReset();
  handlers.length = 0;
  jobStore.dispose();
  for (const d of [...docStore.docs]) docStore.close(d.id);
  failing = new Set();
  submitted = [];
  invoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "ai_submit_generate" || cmd === "ai_submit_edit") {
      let provider: ProviderId;
      let n: number;
      let mode = "generate";
      if (cmd === "ai_submit_generate") {
        const p = (args as { params: { provider: ProviderId; n?: number } }).params;
        provider = p.provider;
        n = p.n ?? 1;
      } else {
        const { header } = decodeFrame<{ provider: ProviderId; n?: number; mode: string; blobs: number[] }>(args as Uint8Array);
        provider = header.provider;
        n = header.n ?? 1;
        mode = header.mode;
      }
      submitted.push({ provider, mode, n });
      const id = `J${++seq}`;
      jobN.set(id, n);
      const results = Array.from({ length: n }, () => ({ width: 4, height: 4, provider, model: "m", mime: "image/png", bytes: 2, ...(provider === "x_ai" ? { costUsd: 0.04 } : {}) }));
      queueMicrotask(() => {
        emit({ job: id, provider, type: "started" });
        if (failing.has(provider)) emit({ job: id, provider, type: "failed", code: "ai_rate_limited", message: "429; Retry-After: 3" });
        else emit({ job: id, provider, type: "completed", results, durationMs: 50 });
      });
      return id;
    }
    if (cmd === "ai_take_result") {
      const n = jobN.get((args as { job: string }).job) ?? 1;
      const metas = Array.from({ length: n }, () => ({ width: 4, height: 4, provider: "x_ai", model: "m", mime: "image/png", bytes: 2 }));
      return encodeFrame({ results: metas }, metas.map(() => new Uint8Array([4, 4]))).buffer;
    }
    return null;
  });
});
afterEach(() => jobStore.dispose());

describe("shootout fan-out", () => {
  it("submits one job per provider, streams previews into cards and records ONE history entry", async () => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    const session = await createShootout(request({ forcedMode: "generate" }), [openai, grok, comfy]);
    expect(session.columns).toHaveLength(3);
    expect(session.mode).toBe("generate");
    expect(session.isEdit).toBe(false);
    await settle(session);
    expect(submitted.map((s) => s.provider)).toEqual(["open_ai", "x_ai", "custom:comfy"]);
    expect(session.columns.every((c) => c.state === "completed")).toBe(true);
    expect(session.columns[0]!.cards[0]!.preview).toMatch(/^data:/);
    expect(session.columns[0]!.cards[0]!.key).toBe(cardKey("open_ai", 0));
    // Nothing was auto-applied: the gallery decides.
    expect(open.doc.layers).toHaveLength(1);
    const hist = getHistory(open.doc);
    expect(hist).toHaveLength(1);
    const e = hist[0]!;
    expect(e.mode).toBe("shootout");
    expect(e.providerName).toBe("Shootout (3 providers)");
    expect(e.status).toBe("completed");
    expect(e.subResults?.map((s) => [s.provider, s.status])).toEqual([
      ["open_ai", "completed"],
      ["x_ai", "completed"],
      ["custom:comfy", "completed"],
    ]);
    expect(e.subResults?.[1]?.costUsd).toBe(0.04);
    expect(e.subResults?.[2]?.costUsd).toBe(0); // local custom provider is free
    expect(e.kept).toEqual([]);
    expect(session.version).toBeGreaterThan(3);
  });

  it("a failed provider shows the typed error in its column and can be retried; the others are unaffected", async () => {
    docStore.create({ width: 16, height: 16, background: "white" });
    failing.add("gemini");
    const session = await createShootout(request({ forcedMode: "generate" }), [grok, gemini]);
    await settle(session);
    const gem = session.column("gemini")!;
    expect(gem.state).toBe("failed");
    expect(gem.error?.code).toBe("ai_rate_limited");
    expect(gem.cards[0]!.preview).toBeNull();
    expect(session.column("x_ai")!.state).toBe("completed");
    const e = getHistory(docStore.doc!)[0]!;
    expect(e.status).toBe("completed");
    expect(e.subResults?.find((s) => s.provider === "gemini")?.error?.code).toBe("ai_rate_limited");

    failing.delete("gemini");
    await session.retry("gemini");
    await settle(session);
    expect(session.column("gemini")!.state).toBe("completed");
    expect(session.column("gemini")!.attempt).toBe(2);
    expect(submitted.filter((s) => s.provider === "gemini")).toHaveLength(2);
    expect(getHistory(docStore.doc!)[0]!.subResults?.find((s) => s.provider === "gemini")?.status).toBe("completed");
  });

  it("variant rows: n per provider is clamped to maxVariants and yields one card each", async () => {
    docStore.create({ width: 16, height: 16, background: "white" });
    const limited = mkProvider("gemini", { capabilities: { ...mkProvider("gemini").capabilities, maxVariants: 2 } });
    const session = await createShootout(request({ n: 3, forcedMode: "generate" }), [grok, limited]);
    expect(session.column("x_ai")!.cards).toHaveLength(3);
    expect(session.column("gemini")!.cards).toHaveLength(2);
    await settle(session);
    expect(submitted.find((s) => s.provider === "gemini")?.n).toBe(2);
    expect(session.column("x_ai")!.cards.map((c) => c.key)).toEqual(["x_ai#0", "x_ai#1", "x_ai#2"]);
    expect(columnKeys(session.column("x_ai")!)).toHaveLength(3);
  });

  it("keep as layers adds the chosen variants to the document and records them in the entry", async () => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    const session = await createShootout(request({ n: 2, forcedMode: "generate" }), [grok, comfy]);
    await settle(session);
    const kept = await session.keepAsLayers([cardKey("x_ai", 1), cardKey("custom:comfy", 0)]);
    expect(kept).toHaveLength(2);
    expect(open.doc.layers).toHaveLength(3);
    const names = open.doc.layers.map((l) => l.name);
    expect(names).toContain("Grok: red fox");
    expect(names).toContain("My ComfyUI: red fox");
    expect(session.card("x_ai#1")?.kept).toBe("layer");
    expect(session.card("x_ai#0")?.kept).toBeNull();
    const e = getHistory(open.doc)[0]!;
    expect(e.kept?.map((k) => [k.provider, k.index, k.as])).toEqual([
      ["x_ai", 1, "layer"],
      ["custom:comfy", 0, "layer"],
    ]);
    expect(e.resultLayerIds).toHaveLength(2);
    expect(findLayer(open.doc, e.resultLayerIds[0]!)).toBeTruthy();
    // Keeping the same card twice is a no-op.
    expect(await session.keepAsLayers([cardKey("x_ai", 1)])).toHaveLength(0);
    expect(open.doc.layers).toHaveLength(3);
  });

  it("keep as new documents opens one document per kept card", async () => {
    docStore.create({ width: 16, height: 16, background: "white" });
    const session = await createShootout(request({ forcedMode: "generate" }), [grok, gemini]);
    await settle(session);
    const before = docStore.docs.length;
    const kept = await session.keepAsDocuments([cardKey("x_ai", 0), cardKey("gemini", 0)]);
    expect(kept.map((k) => k.as)).toEqual(["document", "document"]);
    expect(docStore.docs.length).toBe(before + 2);
    expect(docStore.doc?.layers[0]?.name).toBe("Gemini: red fox");
    expect(session.card("gemini#0")?.kept).toBe("document");
  });

  it("keep & re-run unselected keeps the selection and re-rolls the other providers", async () => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    const session = await createShootout(request({ forcedMode: "generate" }), [grok, gemini]);
    await settle(session);
    await session.keepAndRerunUnselected([cardKey("x_ai", 0)]);
    await settle(session);
    expect(open.doc.layers).toHaveLength(2);
    expect(session.column("gemini")!.attempt).toBe(2);
    expect(session.column("x_ai")!.attempt).toBe(1);
    expect(submitted.filter((s) => s.provider === "gemini")).toHaveLength(2);
  });

  it("mask mode sends the same selection to every provider: native mask for OpenAI, emulated for Grok, and keeps the original thumb", async () => {
    const open = docStore.create({ width: 16, height: 16, background: "white" });
    open.doc.selection = Selection.fromRect(16, 16, Rect.make(4, 4, 8, 8));
    const session = await createShootout(request({ prompt: "add a hat" }), [openai, grok]);
    expect(session.isEdit).toBe(true);
    expect(session.mode).toBe("mask");
    await settle(session);
    expect(session.originalThumb).toMatch(/^data:/);
    expect(submitted.find((s) => s.provider === "open_ai")?.mode).toBe("mask");
    expect(submitted.find((s) => s.provider === "x_ai")?.mode).toBe("instruct");
    expect(session.column("open_ai")!.emulated).toBe(false);
    expect(session.column("x_ai")!.emulated).toBe(true);
    const e = getHistory(open.doc)[0]!;
    expect(e.inputThumb).toMatch(/^data:/);
    expect(e.subResults?.map((s) => s.emulated)).toEqual([false, true]);
  });

  it("createShootout refuses an empty prompt or provider list", async () => {
    await expect(createShootout(request({ prompt: " " }), [grok])).rejects.toThrow(/prompt/);
    await expect(createShootout(request(), [])).rejects.toThrow(/providers/);
  });
});

describe("shootout provider checklist", () => {
  it("defaults to ready generators and persists exclusions in settings", async () => {
    const ollama = mkProvider("custom:ollama", { capabilities: { ...mkProvider("x_ai").capabilities, generate: false, instructEdit: false }, promptAssist: true });
    const noKey = mkProvider("gemini", { hasKey: false });
    expect(shootoutProviders([openai, grok, ollama, noKey, comfy], []).map((p) => p.id)).toEqual(["open_ai", "x_ai", "custom:comfy"]);
    await setShootoutExcluded(["x_ai"]);
    expect(settings.value[SHOOTOUT_EXCLUDED_KEY]).toEqual(["x_ai"]);
    expect(shootoutExcluded()).toEqual(["x_ai"]);
    expect(shootoutProviders([openai, grok, comfy]).map((p) => p.id)).toEqual(["open_ai", "custom:comfy"]);
    await setShootoutExcluded([]);
  });
});
