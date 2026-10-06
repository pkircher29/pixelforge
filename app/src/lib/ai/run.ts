/**
 * Orchestration: a panel request -> inputs (composite / mask / crop) -> job -> layers +
 * history entry. The pure geometry lives in `modes.ts`; this file is the glue between
 * the engine, the doc store, the job store and the IPC client.
 */

import {
  AddLayerCommand,
  Raster,
  Rect,
  Selection,
  compositeSelectionBbox,
  compositeToRaster,
  createDocument,
  createRasterLayer,
  findLayer,
  isEffectivelyVisible,
  type Document,
  type RasterLayer,
} from "$lib/engine";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { submitEdit, submitGenerate, type EditBlobs, type TakenResult } from "./client";
import { addEntry, newHistoryId, updateEntry, type AiHistoryEntry } from "./history";
import { jobStore, type AiJob } from "./jobs.svelte";
import {
  blendMaskFor,
  cropCoverage,
  emulationPadding,
  fitToSize,
  layerNameFor,
  maskedPatch,
  placeOnCanvas,
  regionHint,
  resolveMode,
  type ModeResolution,
} from "./modes";
import { withoutDiffOverlays } from "./overlay";
import { coverageToLumaRaster, decodeImage, encodePng, thumbnailDataUrl } from "./png";
import { estimateCost } from "./pricing";
import type { AiMode, ImageSize, ProviderInfo } from "./types";

export interface AiRunRequest {
  provider: ProviderInfo;
  model: string;
  prompt: string;
  negativePrompt?: string | undefined;
  size?: ImageSize | undefined;
  n: number;
  quality?: string | undefined;
  transparent?: boolean | undefined;
  /** Decoded reference images. */
  refs: Raster[];
  timeoutSecs?: number | undefined;
  /** Generate: open the result as a new document instead of adding a layer. */
  newDocument: boolean;
  forcedMode?: AiMode | undefined;
  /** Feather (px) applied to the selection edge when compositing a mask result back. */
  feather: number;
  /** Re-run with a remembered selection instead of the document's current one. */
  selection?: Selection | undefined;
}

/** Everything needed to turn a result PNG into a layer, computed before submitting. */
export interface PreparedRun {
  resolution: ModeResolution;
  docId: string | null;
  docW: number;
  docH: number;
  /** Emulated: the crop sent. Native mask: the selection bbox. Else null. */
  cropRect: Rect | null;
  /** Blend mask: crop-sized when emulated, canvas-sized for a native mask. */
  coverage: Uint8Array | null;
  /** The selection used (remembered for "Re-run with…"). */
  selection: Selection | null;
  /** Prompt actually sent (region hint prepended when emulating). */
  prompt: string;
  blobs: EditBlobs | null;
  inputThumb?: string;
  maskThumb?: string;
}

/** Selections kept in memory this session so a history entry can be re-run exactly. */
const selectionCache = new Map<string, Selection>();

export function rememberedSelection(historyId: string): Selection | undefined {
  return selectionCache.get(historyId);
}

function hasVisiblePixels(doc: Document): boolean {
  return doc.layers.some((l) => l.kind === "raster" && isEffectivelyVisible(doc, l));
}

/** Resolve the mode for the current document and provider (what the badge shows). */
export function resolveForDoc(doc: Document | null, provider: ProviderInfo | null, forced?: AiMode): ModeResolution {
  return resolveMode({
    hasDoc: doc !== null,
    hasPixels: doc ? hasVisiblePixels(doc) : false,
    selectionEmpty: doc ? doc.selection.isEmpty : true,
    selectionIsAll: doc ? doc.selection.isAll : false,
    caps: provider?.capabilities ?? null,
    forced,
  });
}

async function safeThumb(raster: Raster, opaque: boolean): Promise<string | undefined> {
  try {
    return await thumbnailDataUrl(raster, 160, opaque);
  } catch {
    return undefined;
  }
}

/** Build the inputs. Heavy (composites + PNG encodes) but no IPC yet. */
export async function prepareRun(req: AiRunRequest, open: OpenDoc | null): Promise<PreparedRun> {
  // The diff overlay is a screen-only helper: never send it to a provider.
  const doc = open ? withoutDiffOverlays(open.doc) : null;
  const selection = req.selection ?? doc?.selection ?? null;
  const resolution = resolveMode({
    hasDoc: doc !== null,
    hasPixels: doc ? hasVisiblePixels(doc) : false,
    selectionEmpty: selection ? selection.isEmpty : true,
    selectionIsAll: selection ? selection.isAll : false,
    caps: req.provider.capabilities,
    forced: req.forcedMode,
  });
  const base: PreparedRun = {
    resolution,
    docId: doc?.id ?? null,
    docW: doc?.width ?? 0,
    docH: doc?.height ?? 0,
    cropRect: null,
    coverage: null,
    selection: null,
    prompt: req.prompt.trim(),
    blobs: null,
  };
  const refsPng = await Promise.all(req.refs.map((r) => encodePng(r)));

  if (resolution.mode === "generate") {
    if (refsPng.length > 0) {
      // Generate with references = instruct edit whose image is the first reference.
      base.blobs = { composite: refsPng[0]!, refs: refsPng.slice(1) };
      const thumb = await safeThumb(req.refs[0]!, true);
      if (thumb) base.inputThumb = thumb;
    }
    return base;
  }

  if (!doc || !selection) throw new Error("prepareRun: edit modes need an open document");

  if (resolution.mode === "instruct") {
    const composite = compositeToRaster(doc);
    base.blobs = { composite: await encodePng(composite), refs: refsPng };
    const thumb = await safeThumb(composite, true);
    if (thumb) base.inputThumb = thumb;
    return base;
  }

  // mask
  const bbox = selection.bbox;
  if (!bbox) throw new Error("prepareRun: mask mode without a selection bbox");
  const blend = blendMaskFor(selection, req.feather);
  base.selection = selection;

  if (!resolution.emulated) {
    const composite = compositeToRaster(doc);
    const maskRaster = selection.toLuminanceMask();
    base.cropRect = bbox;
    base.coverage = blend.mask;
    base.blobs = { composite: await encodePng(composite), mask: await encodePng(maskRaster), refs: refsPng };
    const [it, mt] = await Promise.all([safeThumb(composite, true), safeThumb(maskRaster, true)]);
    if (it) base.inputThumb = it;
    if (mt) base.maskThumb = mt;
    return base;
  }

  const padding = emulationPadding(bbox);
  const docWithSel = req.selection ? { ...doc, selection } : doc;
  const cropped = compositeSelectionBbox(docWithSel, padding);
  if (!cropped) throw new Error("prepareRun: empty selection");
  base.cropRect = cropped.rect;
  base.coverage = cropCoverage(blend.mask, doc.width, cropped.rect);
  base.prompt = regionHint(req.prompt);
  base.blobs = { composite: await encodePng(cropped.raster), refs: refsPng };
  const [it, mt] = await Promise.all([
    safeThumb(cropped.raster, true),
    safeThumb(coverageToLumaRaster(base.coverage, cropped.rect.w, cropped.rect.h), true),
  ]);
  if (it) base.inputThumb = it;
  if (mt) base.maskThumb = mt;
  return base;
}

/** Decode one result and build the layer it becomes (not yet inserted). */
export function buildResultLayer(doc: Document, prepared: PreparedRun, raster: Raster, name: string): RasterLayer {
  const { mode, emulated } = prepared.resolution;
  if (mode === "generate") {
    const offset = { x: Math.round((doc.width - raster.width) / 2), y: Math.round((doc.height - raster.height) / 2) };
    return createRasterLayer(doc, { name, raster, offset });
  }
  if (mode === "instruct") {
    return createRasterLayer(doc, { name, raster: fitToSize(raster, doc.width, doc.height) });
  }
  if (!prepared.coverage || !prepared.cropRect) throw new Error("buildResultLayer: mask run without coverage");
  if (emulated) {
    const patch = maskedPatch(raster, prepared.coverage, prepared.cropRect.w, prepared.cropRect.h);
    return createRasterLayer(doc, { name, raster: placeOnCanvas(patch, prepared.cropRect, doc.width, doc.height) });
  }
  return createRasterLayer(doc, { name, raster: maskedPatch(raster, prepared.coverage, doc.width, doc.height) });
}

export interface ApplyOutcome {
  layerId: string;
  docId: string;
}

/**
 * Turn `result` into a layer (or a new document) and select it. Returns the layer id.
 * Works on the job's document even if another one is active.
 */
export async function applyResult(job: AiJob, prepared: PreparedRun, index: number, req: AiRunRequest): Promise<ApplyOutcome> {
  const result = job.results?.[index];
  if (!result) throw new Error("applyResult: no such result");
  const raster = await decodeImage(result.png);
  const name = layerNameFor(req.provider.name, req.prompt);

  let open = prepared.docId ? (docStore.docs.find((d) => d.id === prepared.docId) ?? null) : null;
  const wantsNewDoc = prepared.resolution.mode === "generate" && (req.newDocument || !open);
  if (wantsNewDoc || !open) {
    const doc = createDocument({ width: raster.width, height: raster.height, noBackgroundLayer: true, name: name.slice(0, 48) });
    open = docStore.open(doc, null);
  }
  const doc = open.doc;
  const layer = wantsNewDoc ? createRasterLayer(doc, { name, raster }) : buildResultLayer(doc, prepared, raster, name);
  open.history.push(new AddLayerCommand(layer, undefined, `AI: ${req.provider.name}`));
  doc.activeLayerId = layer.id;
  if (docStore.activeId === open.id) docStore.setActiveLayer(layer.id);
  else open.version++;

  if (!job.applied.includes(index)) job.applied.push(index);
  if (job.historyId) {
    const thumb = await safeThumb(raster, true);
    const entry = findHistoryEntryAnywhere(job.historyId);
    if (entry) {
      entry.doc.dirty = true;
      const e = entry.entry;
      e.resultLayerIds = [...e.resultLayerIds, layer.id];
      if (thumb && !e.resultThumbs[index]) {
        const thumbs = [...e.resultThumbs];
        thumbs[index] = thumb;
        e.resultThumbs = thumbs;
      }
      if (result.meta.costUsd !== undefined) e.costUsd = (e.costUsd ?? 0) + result.meta.costUsd;
      if (entry.open) entry.open.version++;
    }
  }
  return { layerId: layer.id, docId: doc.id };
}

function findHistoryEntryAnywhere(historyId: string): { doc: Document; open: OpenDoc | null; entry: AiHistoryEntry } | null {
  for (const open of docStore.docs) {
    const raw = open.doc.meta.aiHistory;
    if (!Array.isArray(raw)) continue;
    const entry = (raw as AiHistoryEntry[]).find((e) => e.id === historyId);
    if (entry) return { doc: open.doc, open, entry };
  }
  return null;
}

/** In-flight runs, so the panel can offer "add as layer" for multi-variant results. */
export interface ActiveRun {
  job: AiJob;
  prepared: PreparedRun;
  req: AiRunRequest;
}

const runs = new Map<string, ActiveRun>();

export function runFor(jobId: string): ActiveRun | undefined {
  return runs.get(jobId);
}

/** Submit a request end to end. Resolves when the job is terminal and (n = 1) applied. */
export async function runAi(req: AiRunRequest): Promise<ActiveRun> {
  const open = docStore.active;
  const prepared = await prepareRun(req, open);
  const doc = open?.doc ?? null; // the live document (history entries go here)
  const { mode, emulated } = prepared.resolution;
  const cost = estimateCost({ provider: req.provider.id, model: req.model, mode, size: req.size, quality: req.quality, n: req.n });

  let historyId: string | null = null;
  if (doc) {
    const entry: AiHistoryEntry = {
      id: newHistoryId(),
      ts: Date.now(),
      provider: req.provider.id,
      providerName: req.provider.name,
      model: req.model,
      mode,
      emulated,
      prompt: req.prompt.trim(),
      n: req.n,
      resultThumbs: [],
      resultLayerIds: [],
      durationMs: 0,
      status: "running",
      costUsd: cost.usd,
    };
    if (req.negativePrompt) entry.negativePrompt = req.negativePrompt;
    if (req.size) entry.size = req.size;
    if (req.quality) entry.quality = req.quality;
    if (req.transparent) entry.transparent = true;
    if (req.refs.length) entry.refs = req.refs.length;
    if (prepared.cropRect) entry.maskRect = prepared.cropRect;
    if (prepared.inputThumb) entry.inputThumb = prepared.inputThumb;
    if (prepared.maskThumb) entry.maskThumb = prepared.maskThumb;
    addEntry(doc, entry);
    historyId = entry.id;
    if (prepared.selection) selectionCache.set(entry.id, prepared.selection.clone());
    if (open) open.version++;
  }

  const common = {
    provider: req.provider.id,
    prompt: prepared.prompt,
    n: req.n,
    model: req.model,
    ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
    ...(req.size ? { size: req.size } : {}),
    ...(req.quality ? { quality: req.quality } : {}),
    ...(req.transparent ? { transparent: true } : {}),
    ...(req.timeoutSecs ? { timeoutSecs: req.timeoutSecs } : {}),
  };
  const blobs = prepared.blobs;
  const submitFn = blobs
    ? () => submitEdit({ ...common, mode: mode === "mask" && !emulated ? "mask" : "instruct" }, blobs)
    : () => submitGenerate(common);

  const job = await jobStore.submit(
    { provider: req.provider.id, providerName: req.provider.name, model: req.model, mode, emulated, prompt: req.prompt, docId: prepared.docId, historyId, n: req.n },
    submitFn,
  );
  const run: ActiveRun = { job, prepared, req };
  runs.set(job.id, run);

  const done = await jobStore.whenDone(job.id);
  if (doc && historyId) {
    updateEntry(doc, historyId, {
      status: done.state === "completed" ? "completed" : done.state === "cancelled" ? "cancelled" : "failed",
      durationMs: jobStore.elapsedMs(done),
      ...(done.error ? { error: { code: done.error.code, message: done.error.detail } } : {}),
    });
    if (open) open.version++;
  }
  if (done.state === "completed" && done.results && done.results.length === 1) {
    await applyResult(done, prepared, 0, req);
  }
  return run;
}

/** Add every not-yet-applied variant of a finished job as layers. */
export async function applyAll(jobId: string): Promise<void> {
  const run = runs.get(jobId);
  if (!run || !run.job.results) return;
  for (let i = 0; i < run.job.results.length; i++) {
    if (!run.job.applied.includes(i)) await applyResult(run.job, run.prepared, i, run.req);
  }
}

export function applyOne(jobId: string, index: number): Promise<ApplyOutcome | null> {
  const run = runs.get(jobId);
  if (!run) return Promise.resolve(null);
  return applyResult(run.job, run.prepared, index, run.req);
}

/** Decoded previews for the result strip (cached per job). */
const previewCache = new Map<string, string[]>();

export async function resultPreviews(job: AiJob): Promise<string[]> {
  const cached = previewCache.get(job.id);
  if (cached) return cached;
  const results: TakenResult[] = job.results ?? [];
  const urls = await Promise.all(
    results.map(async (r) => {
      try {
        return await thumbnailDataUrl(await decodeImage(r.png), 160, true);
      } catch {
        return "";
      }
    }),
  );
  previewCache.set(job.id, urls);
  return urls;
}

/** Select a layer by id in whichever open doc holds it (for "Reveal layer"). */
export function revealLayer(layerId: string): boolean {
  for (const open of docStore.docs) {
    if (findLayer(open.doc, layerId)) {
      docStore.activate(open.id);
      docStore.setActiveLayer(layerId);
      return true;
    }
  }
  return false;
}
