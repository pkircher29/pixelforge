/**
 * Multi-model shootout (PLAN-v2 §1c): one prompt fanned out to every enabled provider,
 * results streamed into a gallery, then the user keeps some as layers / new documents,
 * re-rolls the rest, or discards. Built on `startAi` (one job per provider through the
 * normal job store) and recorded as **one** AI history entry (`mode: "shootout"`,
 * `docs/ai-history.md`). Pure logic lives here; `AiShootoutDialog.svelte` renders it.
 *
 * Tested with a mocked IPC in `tests/ai/shootout.test.ts`.
 */

import { compositeToRaster, type Raster, type Selection } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { settings } from "$lib/stores/settings.svelte";
import type { FriendlyError } from "./errors";
import { addEntry, newHistoryId, updateEntry, type AiHistoryEntry, type AiShootoutKept, type AiShootoutSubResult } from "./history";
import { jobStore, TERMINAL, type AiJob } from "./jobs.svelte";
import { layerNameFor } from "./modes";
import { withoutDiffOverlays } from "./overlay";
import { thumbnailDataUrl } from "./png";
import { estimateCost } from "./pricing";
import { applyResult, openResultAsDocument, resolveForDoc, resultPreviews, startAi, type AiRunRequest, type StartedRun } from "./run";
import { aiUi } from "./ui.svelte";
import { canGenerate, isReady, type AiMode, type ImageSize, type ProviderId, type ProviderInfo } from "./types";

/** Settings key: providers the user unticked in the shootout checklist. */
export const SHOOTOUT_EXCLUDED_KEY = "aiShootoutExcluded";

export interface ShootoutRequest {
  prompt: string;
  negativePrompt?: string | undefined;
  size?: ImageSize | undefined;
  /** Variants per provider (clamped to each provider's `maxVariants`). */
  n: number;
  refs: Raster[];
  forcedMode?: AiMode | undefined;
  feather: number;
  selection?: Selection | undefined;
  timeoutSecs?: number | undefined;
}

export type ColumnState = "pending" | "submitting" | "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ShootoutCard {
  /** `${provider.id}#${index}`. */
  key: string;
  provider: ProviderInfo;
  index: number;
  /** Data URL once the result is in. */
  preview: string | null;
  /** Where the user kept it, if anywhere. */
  kept: "layer" | "document" | null;
}

export interface ShootoutColumn {
  provider: ProviderInfo;
  run: StartedRun | null;
  state: ColumnState;
  error: FriendlyError | null;
  cards: ShootoutCard[];
  /** Mode this provider ran in (mask may be emulated for some columns). */
  mode: AiMode;
  emulated: boolean;
  /** Attempt counter (bumps on retry so the dialog can key on it). */
  attempt: number;
}

export function cardKey(provider: ProviderId, index: number): string {
  return `${provider}#${index}`;
}

/** Providers that take part by default: ready generators minus the remembered exclusions. */
export function shootoutProviders(all: readonly ProviderInfo[], excluded: readonly ProviderId[] = shootoutExcluded()): ProviderInfo[] {
  return all.filter((p) => canGenerate(p) && isReady(p) && !excluded.includes(p.id));
}

export function shootoutExcluded(): ProviderId[] {
  const raw = settings.value[SHOOTOUT_EXCLUDED_KEY];
  return Array.isArray(raw) ? raw.filter((x): x is ProviderId => typeof x === "string") : [];
}

export function setShootoutExcluded(ids: readonly ProviderId[]): Promise<void> {
  return settings.set({ [SHOOTOUT_EXCLUDED_KEY]: [...ids] });
}

let sessionCounter = 0;

/** One shootout: columns per provider, cards per variant, history entry, keep actions. */
export class ShootoutSession {
  readonly id = `shootout_${++sessionCounter}_${Date.now().toString(36)}`;
  readonly columns: ShootoutColumn[];
  /** Mode as resolved for the document with the first provider (what the gallery is for). */
  readonly mode: AiMode;
  readonly docId: string | null;
  /** Composite thumbnail shown as the "Original" column in edit modes. */
  originalThumb: string | null = null;
  historyId: string | null = null;
  /** Bumped on every change; `subscribe` for push notifications. */
  version = 0;
  private listeners = new Set<() => void>();
  private kept: AiShootoutKept[] = [];

  constructor(
    readonly request: ShootoutRequest,
    providers: readonly ProviderInfo[],
  ) {
    const open = docStore.active;
    this.docId = open?.id ?? null;
    const first = providers[0] ?? null;
    this.mode = resolveForDoc(open?.doc ?? null, first, request.forcedMode).mode;
    this.columns = providers.map((provider) => ({
      provider,
      run: null,
      state: "pending",
      error: null,
      cards: Array.from({ length: this.variantsFor(provider) }, (_, index) => ({ key: cardKey(provider.id, index), provider, index, preview: null, kept: null })),
      mode: this.mode,
      emulated: false,
      attempt: 0,
    }));
  }

  variantsFor(provider: ProviderInfo): number {
    return Math.max(1, Math.min(this.request.n, provider.capabilities.maxVariants));
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private bump(): void {
    this.version++;
    for (const cb of [...this.listeners]) cb();
  }

  get done(): boolean {
    return this.columns.every((c) => c.state === "completed" || c.state === "failed" || c.state === "cancelled");
  }

  get isEdit(): boolean {
    return this.mode !== "generate";
  }

  column(provider: ProviderId): ShootoutColumn | undefined {
    return this.columns.find((c) => c.provider.id === provider);
  }

  card(key: string): ShootoutCard | undefined {
    for (const c of this.columns) {
      const card = c.cards.find((k) => k.key === key);
      if (card) return card;
    }
    return undefined;
  }

  /** The job of a column, live from the job store. */
  job(column: ShootoutColumn): AiJob | null {
    const id = column.run?.job.id;
    return id ? (jobStore.byId(id) ?? column.run?.job ?? null) : null;
  }

  elapsedMs(column: ShootoutColumn): number {
    const job = this.job(column);
    return job ? jobStore.elapsedMs(job) : 0;
  }

  /** Reported cost (from results) or the estimate; null when unknown. */
  costUsd(column: ShootoutColumn): number | null {
    const job = this.job(column);
    const reported = job?.resultMeta?.reduce<number | null>((acc, m) => (m.costUsd === undefined ? acc : (acc ?? 0) + m.costUsd), null);
    if (reported !== null && reported !== undefined) return reported;
    const est = estimateCost({ provider: column.provider.id, model: column.provider.defaultModel, mode: column.mode, size: this.request.size, n: column.cards.length, local: column.provider.local });
    return est ? est.usd : null;
  }

  private runRequest(provider: ProviderInfo): AiRunRequest {
    const isEdit = this.mode !== "generate";
    return {
      provider,
      model: isEdit ? provider.editModel : provider.defaultModel,
      prompt: this.request.prompt,
      negativePrompt: this.request.negativePrompt,
      size: this.request.size,
      n: this.variantsFor(provider),
      refs: this.request.refs,
      timeoutSecs: this.request.timeoutSecs,
      newDocument: false,
      forcedMode: this.request.forcedMode ?? (this.mode === "generate" ? "generate" : undefined),
      feather: this.request.feather,
      selection: this.request.selection,
      noHistory: true,
      autoApply: false,
    };
  }

  /** Fan out: one job per provider, all submitted without waiting for each other. */
  async start(): Promise<void> {
    const open = docStore.active;
    if (open && this.isEdit) {
      try {
        this.originalThumb = await thumbnailDataUrl(compositeToRaster(withoutDiffOverlays(open.doc)), 256, true);
      } catch {
        this.originalThumb = null;
      }
    }
    if (open) {
      const first = this.columns[0]?.provider;
      const entry: AiHistoryEntry = {
        id: newHistoryId(),
        ts: Date.now(),
        provider: first?.id ?? "open_ai",
        providerName: `Shootout (${this.columns.length} provider${this.columns.length === 1 ? "" : "s"})`,
        model: "",
        mode: "shootout",
        emulated: false,
        prompt: this.request.prompt.trim(),
        n: this.request.n,
        resultThumbs: [],
        resultLayerIds: [],
        durationMs: 0,
        status: "running",
        subResults: this.columns.map((c) => this.subResult(c)),
        kept: [],
      };
      if (this.request.negativePrompt) entry.negativePrompt = this.request.negativePrompt;
      if (this.request.size) entry.size = this.request.size;
      if (this.originalThumb) entry.inputThumb = this.originalThumb;
      addEntry(open.doc, entry);
      this.historyId = entry.id;
      open.version++;
    }
    this.bump();
    await Promise.all(this.columns.map((c) => this.launch(c)));
  }

  private subResult(c: ShootoutColumn): AiShootoutSubResult {
    const job = this.job(c);
    const status: AiShootoutSubResult["status"] = c.state === "completed" ? "completed" : c.state === "failed" ? "failed" : c.state === "cancelled" ? "cancelled" : "running";
    const sub: AiShootoutSubResult = {
      provider: c.provider.id,
      providerName: c.provider.name,
      model: c.run?.req.model ?? c.provider.defaultModel,
      mode: c.mode,
      emulated: c.emulated,
      status,
      durationMs: job ? jobStore.elapsedMs(job) : 0,
      thumbs: c.cards.map((k) => k.preview ?? ""),
    };
    const cost = this.costUsd(c);
    if (cost !== null) sub.costUsd = cost;
    if (c.error) sub.error = { code: c.error.code, message: c.error.detail };
    return sub;
  }

  private syncHistory(): void {
    if (!this.historyId || !this.docId) return;
    const open = docStore.get(this.docId);
    if (!open) return;
    const allDone = this.done;
    const anyOk = this.columns.some((c) => c.state === "completed");
    updateEntry(open.doc, this.historyId, {
      subResults: this.columns.map((c) => this.subResult(c)),
      kept: [...this.kept],
      status: allDone ? (anyOk ? "completed" : this.columns.every((c) => c.state === "cancelled") ? "cancelled" : "failed") : "running",
      durationMs: Math.max(0, ...this.columns.map((c) => this.elapsedMs(c))),
      resultThumbs: this.columns.flatMap((c) => c.cards.map((k) => k.preview ?? "")),
      resultLayerIds: this.kept.flatMap((k) => (k.layerId ? [k.layerId] : [])),
      ...(anyOk ? {} : {}),
    });
    open.version++;
  }

  private async launch(column: ShootoutColumn): Promise<void> {
    column.attempt++;
    column.state = "submitting";
    column.error = null;
    column.run = null;
    for (const card of column.cards) {
      card.preview = null;
      card.kept = null;
    }
    this.bump();
    let started: StartedRun;
    try {
      started = await startAi(this.runRequest(column.provider));
    } catch (e) {
      column.state = "failed";
      column.error = { code: "ai_invalid_request", title: e instanceof Error ? e.message : String(e), hint: "", retryable: false, detail: e instanceof Error ? e.message : String(e) };
      this.syncHistory();
      this.bump();
      return;
    }
    column.run = started;
    column.mode = started.prepared.resolution.mode;
    column.emulated = started.prepared.resolution.emulated;
    column.state = this.stateOf(started.job);
    this.bump();
    const finished = await started.done;
    column.state = this.stateOf(finished);
    column.error = finished.error;
    if (finished.state === "completed" && finished.results) {
      const previews = await resultPreviews(finished);
      column.cards = finished.results.map((_, index) => ({ key: cardKey(column.provider.id, index), provider: column.provider, index, preview: previews[index] ?? null, kept: null }));
    }
    this.syncHistory();
    this.bump();
  }

  private stateOf(job: AiJob): ColumnState {
    switch (job.state) {
      case "submitting":
        return "submitting";
      case "queued":
        return "queued";
      case "running":
        return "running";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
    }
  }

  /** Re-submit one provider (retry after a failure, or re-roll). */
  async retry(provider: ProviderId): Promise<void> {
    const column = this.column(provider);
    if (!column) return;
    const job = this.job(column);
    if (job && !TERMINAL.has(job.state)) return;
    await this.launch(column);
  }

  /** Cancel every job that is still running. */
  async cancelAll(): Promise<void> {
    await Promise.all(
      this.columns.map(async (c) => {
        const job = this.job(c);
        if (job && !TERMINAL.has(job.state)) await jobStore.cancel(job.id);
      }),
    );
  }

  /** Add the selected cards as layers (named `<Provider>: <prompt>`) on the session's document. */
  async keepAsLayers(keys: readonly string[]): Promise<AiShootoutKept[]> {
    const out: AiShootoutKept[] = [];
    for (const key of keys) {
      const card = this.card(key);
      const column = card ? this.column(card.provider.id) : undefined;
      const run = column?.run;
      const job = column ? this.job(column) : null;
      if (!card || !column || !run || !job || job.state !== "completed" || !job.results?.[card.index]) continue;
      if (card.kept) continue;
      const outcome = await applyResult(job, run.prepared, card.index, run.req);
      card.kept = "layer";
      const kept: AiShootoutKept = { provider: card.provider.id, index: card.index, as: "layer", layerId: outcome.layerId, docId: outcome.docId };
      this.kept.push(kept);
      out.push(kept);
    }
    this.syncHistory();
    this.bump();
    return out;
  }

  /** Open each selected card as a new document. */
  async keepAsDocuments(keys: readonly string[]): Promise<AiShootoutKept[]> {
    const out: AiShootoutKept[] = [];
    for (const key of keys) {
      const card = this.card(key);
      const column = card ? this.column(card.provider.id) : undefined;
      const job = column ? this.job(column) : null;
      const result = job?.results?.[card?.index ?? -1];
      if (!card || !column || !job || !result || card.kept) continue;
      const outcome = await openResultAsDocument(result, layerNameFor(card.provider.name, this.request.prompt));
      card.kept = "document";
      const kept: AiShootoutKept = { provider: card.provider.id, index: card.index, as: "document", layerId: outcome.layerId, docId: outcome.docId };
      this.kept.push(kept);
      out.push(kept);
    }
    this.syncHistory();
    this.bump();
    return out;
  }

  /** Keep the selected cards as layers, then re-roll every provider with an unselected card. */
  async keepAndRerunUnselected(keys: readonly string[]): Promise<void> {
    await this.keepAsLayers(keys);
    const rerun = this.columns.filter((c) => c.state !== "pending" && c.cards.some((k) => !keys.includes(k.key) && !k.kept));
    await Promise.all(rerun.map((c) => this.launch(c)));
  }

  /** Cancel what is running and forget the session (the history entry stays). */
  async discard(): Promise<void> {
    await this.cancelAll();
    this.syncHistory();
    this.bump();
  }
}

/** Keys of every card in a column (for "select all" in a column header). */
export function columnKeys(column: ShootoutColumn): string[] {
  return column.cards.filter((c) => c.preview !== null && !c.kept).map((c) => c.key);
}

/** Build a session from a request and start it. */
export async function createShootout(req: ShootoutRequest, providers: readonly ProviderInfo[]): Promise<ShootoutSession> {
  if (providers.length === 0) throw new Error("No providers are enabled for the shootout. Tick at least one in the checklist.");
  if (!req.prompt.trim()) throw new Error("Type a prompt first.");
  const session = new ShootoutSession(req, providers);
  void session.start();
  return session;
}

/** Current AI panel form -> shootout request. */
export function requestFromPanel(): ShootoutRequest {
  return {
    prompt: aiUi.prompt,
    negativePrompt: aiUi.negativePrompt.trim() || undefined,
    n: aiUi.n,
    refs: aiUi.refs.map((r) => r.raster),
    forcedMode: aiUi.forcedMode,
    feather: aiUi.feather,
    timeoutSecs: aiUi.timeoutSecs !== 180 ? aiUi.timeoutSecs : undefined,
  };
}

/**
 * "Run on all ▸": take the panel's prompt and options, fan out to every enabled
 * provider and open the gallery. Returns null when nothing could start (empty prompt,
 * no providers) after showing the reason through the returned error.
 */
export async function runOnAll(opts: { providers?: readonly ProviderInfo[]; open?: (s: ShootoutSession) => void } = {}): Promise<ShootoutSession> {
  const providers = opts.providers ?? shootoutProviders(aiUi.providers);
  const session = await createShootout(requestFromPanel(), providers);
  if (opts.open) opts.open(session);
  else {
    const { openShootoutDialog } = await import("./dialogs");
    openShootoutDialog(session);
  }
  return session;
}
