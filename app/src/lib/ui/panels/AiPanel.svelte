<script lang="ts">
  /**
   * AI panel: provider / model / mode / prompt / options / run / jobs / results.
   * Registered by `$lib/ai/register` as panel `ai` (right dock, order 15).
   *
   * Self-contained on purpose (Wave 3 runs in parallel with the shell): inline status
   * messages instead of the toast store, own styling on the app.css tokens.
   * TODO(shell): swap `.notice` for the shared toast store once `lib/stores/toast` lands.
   */
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import {
    ChevronDown,
    ChevronRight,
    ImagePlus,
    KeyRound,
    LoaderCircle,
    ScanEye,
    Sparkles,
    X,
  } from "@lucide/svelte";
  import { Raster } from "$lib/engine";
  import { decodeFrame } from "$lib/io/frame";
  import { docStore } from "$lib/stores/doc.svelte";
  import { hasTauri } from "$lib/ai/client";
  import { openApiKeysDialog } from "$lib/ai/dialogs";
  import { jobStore, TERMINAL, type AiJob } from "$lib/ai/jobs.svelte";
  import { toggleDiffOverlay } from "$lib/ai/overlay";
  import { decodeImage, thumbnailDataUrl } from "$lib/ai/png";
  import { estimateCost, formatUsd } from "$lib/ai/pricing";
  import { applyAll, applyOne, resolveForDoc, resultPreviews, runAi, runFor, type AiRunRequest } from "$lib/ai/run";
  import { aiUi, type SizeOption } from "$lib/ai/ui.svelte";
  import { PROVIDER_LABEL, PROVIDER_IDS, type AiMode, type ImageSize, type ProviderId } from "$lib/ai/types";

  let promptEl = $state<HTMLTextAreaElement | null>(null);
  let dropEl = $state<HTMLDivElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let dragOver = $state(false);
  let notice = $state<{ kind: "info" | "error"; text: string } | null>(null);
  let previews = $state<Record<string, string[]>>({});
  let busy = $state(false);

  const version = $derived(docStore.active?.version ?? -1);
  const doc = $derived.by(() => {
    void version;
    return docStore.doc;
  });
  const provider = $derived(aiUi.provider);
  const caps = $derived(provider?.capabilities ?? null);
  const resolution = $derived.by(() => {
    void version;
    return resolveForDoc(doc, provider, aiUi.forcedMode);
  });
  const mode: AiMode = $derived(resolution.mode);
  const isEdit = $derived(mode !== "generate");
  const effectiveModel = $derived(aiUi.model || (isEdit ? (provider?.editModel ?? "") : (provider?.defaultModel ?? "")));
  const maxRefs = $derived(Math.max(0, (caps?.maxRefs ?? 1) - 1));
  const maxN = $derived(Math.min(4, caps?.maxVariants ?? 1));

  const qualityOptions = $derived.by((): string[] => {
    if (!provider) return [];
    if (provider.id === "open_ai") return ["auto", "low", "medium", "high", "xhigh", "max"];
    if (provider.id === "x_ai") return ["auto", "low", "medium"];
    return [];
  });

  function tierEdge(tier: string): number {
    const t = tier.toLowerCase();
    if (t === "512") return 512;
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? Math.round(n * 1024) : 1024;
  }

  function sizeFromRatio(ratio: string, edge: number): ImageSize {
    const [w, h] = ratio.split(":").map(Number);
    if (!w || !h) return { width: edge, height: edge };
    const r = w / h;
    const width = r >= 1 ? edge : Math.round((edge * r) / 16) * 16;
    const height = r >= 1 ? Math.round(edge / r / 16) * 16 : edge;
    return { width: Math.max(16, width), height: Math.max(16, height) };
  }

  const sizeOptions = $derived.by((): SizeOption[] => {
    const out: SizeOption[] = [{ key: "auto", label: isEdit ? "Auto (same as input)" : "Auto" }];
    if (!caps) return out;
    if (doc && caps.customSizes) {
      const w = Math.min(caps.maxPx, Math.round(doc.width / 16) * 16);
      const h = Math.min(caps.maxPx, Math.round(doc.height / 16) * 16);
      out.push({ key: "doc", label: `Match document (${w} x ${h})`, size: { width: w, height: h } });
    }
    for (const s of caps.sizes) out.push({ key: `${s.width}x${s.height}`, label: `${s.width} x ${s.height}`, size: s });
    if (caps.aspectRatios.length) {
      const tiers = caps.resolutions.length ? caps.resolutions : ["1k"];
      for (const tier of tiers) {
        const edge = Math.min(caps.maxPx, tierEdge(tier));
        for (const ratio of caps.aspectRatios) {
          out.push({ key: `${ratio}@${tier}`, label: `${ratio} at ${tier}`, size: sizeFromRatio(ratio, edge) });
        }
      }
    }
    return out;
  });
  const chosenSize = $derived(sizeOptions.find((o) => o.key === aiUi.sizeKey)?.size);

  const cost = $derived(
    provider
      ? estimateCost({ provider: provider.id, model: effectiveModel, mode, size: chosenSize, quality: aiUi.quality || undefined, n: aiUi.n })
      : null,
  );

  const canRun = $derived(Boolean(provider && aiUi.prompt.trim().length > 0 && !busy && (provider?.hasKey || !hasTauri())));
  const modeLabel = $derived(mode === "generate" ? "Generate" : mode === "mask" ? "Mask edit" : "Instruct edit");
  const flow = $derived.by(() => {
    const name = provider?.name ?? "provider";
    if (mode === "generate") return aiUi.newDocument || !doc ? `prompt → ${name} → new document` : `prompt → ${name} → new layer`;
    if (mode === "mask") return `selection → ${name} → new layer`;
    return `composite → ${name} → new layer`;
  });

  onMount(() => {
    void aiUi.refreshProviders();
    let unlisten: (() => void) | null = null;
    if (hasTauri()) {
      // Native drag-drop delivers paths, not files (tauri.conf `dragDropEnabled: true`).
      void listen<{ paths?: string[]; position?: { x: number; y: number } }>("tauri://drag-drop", (e) => {
        const p = e.payload;
        if (!p.paths?.length || !dropEl) return;
        const r = dropEl.getBoundingClientRect();
        const pos = p.position;
        if (pos && !(pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom)) return;
        void addRefPaths(p.paths);
      })
        .then((u) => (unlisten = u))
        .catch(() => undefined);
    }
    return () => unlisten?.();
  });

  $effect(() => {
    void aiUi.focusRequest;
    if (aiUi.focusRequest > 0) promptEl?.focus();
  });

  $effect(() => {
    // Keep variants and refs inside the provider's limits when the provider changes.
    if (aiUi.n > maxN) aiUi.n = maxN;
    if (aiUi.refs.length > maxRefs) aiUi.refs = aiUi.refs.slice(0, maxRefs);
    if (!qualityOptions.includes(aiUi.quality)) aiUi.quality = "";
    if (!sizeOptions.some((o) => o.key === aiUi.sizeKey)) aiUi.sizeKey = "auto";
    if (provider && !provider.capabilities.transparentBg) aiUi.transparent = false;
  });

  function pickProvider(id: ProviderId): void {
    const p = aiUi.providers.find((x) => x.id === id);
    if (p && !p.hasKey && hasTauri()) {
      openApiKeysDialog();
    }
    aiUi.providerId = id;
    aiUi.model = "";
  }

  async function addRefRaster(raster: Raster, name: string): Promise<void> {
    if (aiUi.refs.length >= maxRefs) {
      notice = { kind: "info", text: `${provider?.name ?? "This provider"} accepts up to ${maxRefs} reference image${maxRefs === 1 ? "" : "s"}.` };
      return;
    }
    const thumb = await thumbnailDataUrl(raster, 96, true);
    aiUi.addRef({ name, raster, thumb });
  }

  async function addRefFiles(files: Iterable<File>): Promise<void> {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      try {
        await addRefRaster(await decodeImage(f), f.name);
      } catch {
        notice = { kind: "error", text: `Could not read ${f.name}.` };
      }
    }
  }

  interface OpenLayer {
    w: number;
    h: number;
    blob: number | null;
  }

  async function addRefPaths(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        const buf = await invoke<ArrayBuffer>("io_open", { path });
        const { header, blobs } = decodeFrame<{ blobs: number[]; width: number; height: number; layers: OpenLayer[] }>(buf);
        const first = header.layers.find((l) => l.blob !== null);
        if (!first || first.blob === null) continue;
        const raster = Raster.fromBytes(first.w, first.h, blobs[first.blob]!);
        await addRefRaster(raster, path.split(/[\\/]/).pop() ?? path);
      } catch {
        notice = { kind: "error", text: `Could not open ${path}.` };
      }
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer?.files.length) void addRefFiles(e.dataTransfer.files);
  }

  function onPaste(e: ClipboardEvent): void {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      void addRefFiles(files);
    }
  }

  function onPromptKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void run();
    }
  }

  export async function run(): Promise<void> {
    if (!provider || !canRun) return;
    notice = null;
    const req: AiRunRequest = {
      provider,
      model: effectiveModel,
      prompt: aiUi.prompt,
      negativePrompt: aiUi.negativePrompt.trim() || undefined,
      size: chosenSize,
      n: aiUi.n,
      quality: aiUi.quality || undefined,
      transparent: aiUi.transparent && provider.capabilities.transparentBg,
      refs: aiUi.refs.map((r) => r.raster),
      timeoutSecs: aiUi.timeoutSecs !== 180 ? aiUi.timeoutSecs : undefined,
      newDocument: aiUi.newDocument,
      forcedMode: aiUi.forcedMode,
      feather: aiUi.feather,
    };
    aiUi.lastRun = req;
    aiUi.forcedMode = undefined;
    busy = true;
    try {
      const r = await runAi(req);
      if (r.job.state === "completed" && r.job.results && r.job.results.length > 1) {
        previews[r.job.id] = await resultPreviews(r.job);
        notice = { kind: "info", text: `${r.job.results.length} variants ready. Click one to add it as a layer.` };
      } else if (r.job.state === "completed") {
        notice = { kind: "info", text: `${provider.name} added a layer.` };
      } else if (r.job.state === "failed" && r.job.error) {
        notice = { kind: "error", text: `${r.job.error.title} ${r.job.error.hint}`.trim() };
      }
    } catch (e) {
      notice = { kind: "error", text: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }

  async function addVariant(job: AiJob, i: number): Promise<void> {
    try {
      await applyOne(job.id, i);
    } catch (e) {
      notice = { kind: "error", text: e instanceof Error ? e.message : String(e) };
    }
  }

  function showDiff(job: AiJob): void {
    const run = runFor(job.id);
    const open = docStore.docs.find((d) => d.id === job.docId);
    if (!run || !open) return;
    const entry = (open.doc.meta.aiHistory as { id: string; resultLayerIds: string[] }[] | undefined)?.find((e) => e.id === job.historyId);
    const layerId = entry?.resultLayerIds[entry.resultLayerIds.length - 1];
    if (layerId) toggleDiffOverlay(open, layerId);
  }

  function elapsed(job: AiJob): string {
    return `${(jobStore.elapsedMs(job) / 1000).toFixed(1)} s`;
  }

  function stateLabel(job: AiJob): string {
    switch (job.state) {
      case "submitting":
        return "Sending";
      case "queued":
        return "Queued";
      case "running":
        return "Running";
      case "completed":
        return "Done";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
    }
  }

  const providerRows = $derived(
    PROVIDER_IDS.map((id) => {
      const p = aiUi.providers.find((x) => x.id === id);
      return { id, name: p?.name ?? PROVIDER_LABEL[id], hasKey: p?.hasKey ?? false, known: Boolean(p) };
    }),
  );
</script>

<div class="ai" onpaste={onPaste}>
  <div class="providers" role="radiogroup" aria-label="Provider">
    {#each providerRows as p (p.id)}
      <button
        type="button"
        class="chip"
        class:on={aiUi.providerId === p.id}
        role="radio"
        aria-checked={aiUi.providerId === p.id}
        title={p.hasKey ? `${p.name}: key saved` : `${p.name}: no key yet, click to add one`}
        onclick={() => pickProvider(p.id)}
      >
        <span class="dot" class:ok={p.hasKey}></span>
        {p.name}
      </button>
    {/each}
    <button type="button" class="icon" title="AI API keys" aria-label="AI API keys" onclick={openApiKeysDialog}>
      <KeyRound size={14} />
    </button>
  </div>

  {#if aiUi.providersError}
    <p class="notice error">{aiUi.providersError}</p>
  {/if}

  <div class="row">
    <label class="field grow">
      <span>Model</span>
      <select bind:value={aiUi.model}>
        <option value="">Default ({isEdit ? (provider?.editModel ?? "–") : (provider?.defaultModel ?? "–")})</option>
        {#each provider?.models ?? [] as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="mode" title={resolution.reason}>
    <span class="badge" class:gen={mode === "generate"} class:mask={mode === "mask"} class:instr={mode === "instruct"}>{modeLabel}</span>
    {#if resolution.emulated}
      <span class="emu" title="This provider has no pixel mask. Pixelforge crops the composite to the selection, sends an instruct edit, and pastes the result back only under the selection.">emulated</span>
    {/if}
    <span class="flow">{flow}</span>
    {#if aiUi.forcedMode}
      <button type="button" class="link" onclick={() => (aiUi.forcedMode = undefined)}>auto</button>
    {/if}
  </div>

  <textarea
    bind:this={promptEl}
    bind:value={aiUi.prompt}
    class="prompt"
    rows="4"
    placeholder={mode === "generate" ? "Describe the image to make…" : mode === "mask" ? "What should change inside the selection?" : "How should the whole image change?"}
    onkeydown={onPromptKey}
    aria-label="Prompt"
  ></textarea>

  {#if !aiUi.prompt && jobStore.jobs.length === 0}
    <p class="empty">
      With nothing selected the whole image is edited; with a selection only that region changes.
      Every result lands on a new layer, so you can chain providers: rough it in with Grok, refine with Gemini, finish with ChatGPT.
    </p>
  {/if}

  <button type="button" class="disclosure" onclick={() => (aiUi.showNegative = !aiUi.showNegative)} aria-expanded={aiUi.showNegative}>
    {#if aiUi.showNegative}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
    Avoid
    {#if !aiUi.showNegative && aiUi.negativePrompt}<span class="muted">· {aiUi.negativePrompt.slice(0, 32)}</span>{/if}
  </button>
  {#if aiUi.showNegative}
    <textarea bind:value={aiUi.negativePrompt} class="prompt small" rows="2" placeholder="Things to leave out (folded into the prompt)" aria-label="Negative prompt"></textarea>
  {/if}

  <div
    bind:this={dropEl}
    class="refs"
    class:over={dragOver}
    role="group"
    aria-label="Reference images"
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
  >
    {#each aiUi.refs as r (r.id)}
      <div class="ref" title={r.name}>
        <img src={r.thumb} alt={r.name} />
        <button type="button" class="rm" aria-label="Remove {r.name}" onclick={() => aiUi.removeRef(r.id)}><X size={10} /></button>
      </div>
    {/each}
    {#if aiUi.refs.length < maxRefs}
      <button type="button" class="add" onclick={() => fileInput?.click()} title="Add reference images (drop, paste or browse)">
        <ImagePlus size={14} />
        <span>{aiUi.refs.length === 0 ? `Reference images (up to ${maxRefs})` : `${aiUi.refs.length} of ${maxRefs}`}</span>
      </button>
    {:else}
      <span class="muted small-text">{maxRefs} of {maxRefs} references</span>
    {/if}
    <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={(e) => void addRefFiles((e.currentTarget as HTMLInputElement).files ?? [])} />
  </div>

  <div class="grid">
    <label class="field">
      <span>Size</span>
      <select bind:value={aiUi.sizeKey}>
        {#each sizeOptions as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span>Variants</span>
      <select bind:value={aiUi.n}>
        {#each Array.from({ length: maxN }, (_, i) => i + 1) as k (k)}<option value={k}>{k}</option>{/each}
      </select>
    </label>
    {#if qualityOptions.length}
      <label class="field">
        <span>Quality</span>
        <select bind:value={aiUi.quality}>
          <option value="">Default</option>
          {#each qualityOptions as q (q)}<option value={q}>{q}</option>{/each}
        </select>
      </label>
    {/if}
    {#if caps?.transparentBg}
      <label class="check">
        <input type="checkbox" bind:checked={aiUi.transparent} />
        Transparent background
      </label>
    {/if}
    {#if mode === "generate" && doc}
      <label class="check">
        <input type="checkbox" bind:checked={aiUi.newDocument} />
        New document
      </label>
    {/if}
  </div>

  <div class="run">
    <button type="button" class="primary" disabled={!canRun} onclick={run} title="Ctrl+Enter">
      {#if busy}<LoaderCircle size={14} class="spin" />{:else}<Sparkles size={14} />{/if}
      Run
    </button>
    {#if cost}
      <span class="cost" title={cost.note}>{formatUsd(cost.usd, cost.approx)}</span>
    {/if}
    {#if provider && !provider.hasKey && hasTauri()}
      <button type="button" class="link" onclick={openApiKeysDialog}>Add {provider.name} key</button>
    {/if}
  </div>

  {#if notice}
    <p class="notice" class:error={notice.kind === "error"}>
      {notice.text}
      <button type="button" class="rm-notice" aria-label="Dismiss" onclick={() => (notice = null)}><X size={10} /></button>
    </p>
  {/if}

  {#if jobStore.jobs.length}
    <ul class="jobs" aria-label="Jobs">
      {#each jobStore.jobs.slice(0, 6) as job (job.id)}
        <li class="job" class:failed={job.state === "failed"}>
          <div class="job-head">
            {#if !TERMINAL.has(job.state)}<LoaderCircle size={12} class="spin" />{/if}
            <span class="job-prov">{job.providerName}</span>
            <span class="job-state">{stateLabel(job)}</span>
            <span class="muted">{elapsed(job)}</span>
            <span class="grow"></span>
            {#if !TERMINAL.has(job.state)}
              <button type="button" class="link" onclick={() => void jobStore.cancel(job.id)}>Cancel</button>
            {:else}
              {#if job.state === "completed" && job.docId}
                <button type="button" class="icon" title="Toggle diff overlay" aria-label="Toggle diff overlay" onclick={() => showDiff(job)}><ScanEye size={13} /></button>
              {/if}
              <button type="button" class="icon" title="Remove" aria-label="Remove job" onclick={() => jobStore.remove(job.id)}><X size={12} /></button>
            {/if}
          </div>
          <div class="job-prompt" title={job.prompt}>{job.prompt}</div>
          {#if job.error}
            <div class="job-err">
              {job.error.title}
              {#if job.error.hint}<span class="muted"> {job.error.hint}</span>{/if}
            </div>
          {/if}
          {#if job.state === "completed" && job.results && job.results.length > 1}
            <div class="variants">
              {#each previews[job.id] ?? [] as url, i (i)}
                <button type="button" class="variant" class:added={job.applied.includes(i)} title="Add variant {i + 1} as a layer" onclick={() => void addVariant(job, i)}>
                  {#if url}<img src={url} alt="Variant {i + 1}" />{:else}<span class="muted">{i + 1}</span>{/if}
                </button>
              {/each}
              <button type="button" class="link" onclick={() => void applyAll(job.id)}>Add all</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <button type="button" class="disclosure" onclick={() => (aiUi.showAdvanced = !aiUi.showAdvanced)} aria-expanded={aiUi.showAdvanced}>
    {#if aiUi.showAdvanced}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
    Advanced
  </button>
  {#if aiUi.showAdvanced}
    <div class="grid">
      <label class="field">
        <span>Timeout (s)</span>
        <input type="number" min="10" max="3600" step="10" bind:value={aiUi.timeoutSecs} />
      </label>
      <label class="field">
        <span>Edge feather (px)</span>
        <input type="number" min="0" max="64" step="1" bind:value={aiUi.feather} />
      </label>
    </div>
  {/if}
</div>

<style>
  .ai {
    --ok: #43d17a;
    --magenta: #ff00c8;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    font-size: var(--fs-sm);
    color: var(--fg-1);
    overflow-y: auto;
    min-height: 0;
    height: 100%;
  }
  .ai > * {
    flex: none;
  }

  .providers {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: 999px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    color: var(--fg-1);
  }
  .chip:hover {
    color: var(--fg-0);
    border-color: var(--border-strong);
  }
  .chip.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--fg-0);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-2);
  }
  .dot.ok {
    background: var(--ok);
    box-shadow: 0 0 6px rgba(67, 209, 122, 0.6);
  }

  .icon {
    display: inline-flex;
    padding: 4px;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
  }
  .icon:hover {
    color: var(--fg-0);
    background: var(--bg-3);
  }

  .row,
  .grid {
    display: grid;
    gap: 6px;
  }
  .grid {
    grid-template-columns: 1fr 1fr;
    align-items: end;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .field > span {
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .grow {
    flex: 1;
  }
  select,
  input[type="number"] {
    width: 100%;
    font: inherit;
    color: var(--fg-0);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 6px;
  }
  select:focus-visible,
  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-1);
    padding-bottom: 4px;
  }

  .mode {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 8px;
    border-radius: var(--radius-md);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .badge {
    padding: 1px 7px;
    border-radius: 999px;
    font-weight: 600;
    color: var(--bg-0);
    background: var(--fg-1);
  }
  .badge.gen {
    background: var(--accent);
    color: #fff;
  }
  .badge.mask {
    background: var(--magenta);
    color: #fff;
  }
  .badge.instr {
    background: var(--accent-2);
    color: var(--bg-0);
  }
  .emu {
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px dashed var(--accent-2);
    color: var(--accent-2);
    font-size: var(--fs-xs);
  }
  .flow {
    color: var(--fg-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .prompt {
    width: 100%;
    resize: vertical;
    font: inherit;
    font-size: var(--fs-md);
    line-height: 1.45;
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    user-select: text;
    -webkit-user-select: text;
  }
  .prompt.small {
    font-size: var(--fs-sm);
  }
  .prompt::placeholder {
    color: var(--fg-2);
  }

  .empty {
    margin: 0;
    color: var(--fg-2);
    line-height: 1.5;
  }

  .disclosure {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--fg-2);
    font-size: var(--fs-xs);
    align-self: flex-start;
  }
  .disclosure:hover {
    color: var(--fg-0);
  }

  .refs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    min-height: 40px;
    padding: 6px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
  }
  .refs.over {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .ref {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-2);
  }
  .ref img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .rm {
    position: absolute;
    top: 1px;
    right: 1px;
    display: inline-flex;
    padding: 2px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-2);
    padding: 4px 6px;
    border-radius: var(--radius-sm);
  }
  .add:hover {
    color: var(--fg-0);
    background: var(--bg-2);
  }

  .run {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    box-shadow: var(--shadow-1);
  }
  .primary:hover:not(:disabled) {
    box-shadow: var(--glow-accent);
  }
  .primary:disabled {
    opacity: 0.45;
  }
  .cost {
    font-family: var(--font-mono);
    color: var(--fg-1);
  }
  .link {
    color: var(--accent-2);
    font-size: var(--fs-xs);
  }
  .link:hover {
    text-decoration: underline;
  }

  .notice {
    position: relative;
    margin: 0;
    padding: 6px 24px 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-2);
    border-left: 2px solid var(--accent-2);
    color: var(--fg-0);
  }
  .notice.error {
    border-left-color: var(--danger);
  }
  .rm-notice {
    position: absolute;
    top: 6px;
    right: 6px;
    color: var(--fg-2);
    display: inline-flex;
  }

  .jobs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .job {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .job.failed {
    border-color: rgba(255, 92, 122, 0.4);
  }
  .job-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .job-prov {
    font-weight: 600;
    color: var(--fg-0);
  }
  .job-state {
    color: var(--fg-1);
  }
  .job-prompt {
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }
  .job-err {
    margin-top: 4px;
    color: var(--danger);
  }
  .variants {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .variant {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-3);
    border: 2px solid transparent;
  }
  .variant img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .variant:hover {
    border-color: var(--accent);
  }
  .variant.added {
    border-color: var(--ok);
  }
  .muted {
    color: var(--fg-2);
  }
  .small-text {
    font-size: var(--fs-xs);
  }

  :global(.ai .spin) {
    animation: ai-spin 0.9s linear infinite;
  }
  @keyframes ai-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.ai .spin) {
      animation: none;
    }
  }
</style>
