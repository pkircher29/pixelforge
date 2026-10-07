<script lang="ts">
  /**
   * AI panel: provider / model / mode / prompt / options / run / jobs / results.
   * Registered by `$lib/ai/register` as panel `ai` (group `history`).
   *
   * Photoshop idiom (Wave 6): flat `--ps-*` surfaces, 22 px rows, PsSelect / ScrubbyNumber
   * fields, collapsible section headers (Prompt / Reference images / Options / Advanced),
   * a Run split button ("Run on all" in the caret half), compact job rows with a thin
   * progress bar. Behaviour is unchanged from Wave 3/5.
   */
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { Raster } from "$lib/engine";
  import { decodeFrame } from "$lib/io/frame";
  import { docStore } from "$lib/stores/doc.svelte";
  import { assistProviders, improvePrompt } from "$lib/ai/assist";
  import { hasTauri } from "$lib/ai/client";
  import { openApiKeysDialog, openShootoutDialog } from "$lib/ai/dialogs";
  import { jobStore, TERMINAL, type AiJob } from "$lib/ai/jobs.svelte";
  import { toggleDiffOverlay } from "$lib/ai/overlay";
  import { decodeImage, thumbnailDataUrl } from "$lib/ai/png";
  import { estimateCost, formatUsd } from "$lib/ai/pricing";
  import ProviderPicker from "$lib/ai/ProviderPicker.svelte";
  import { applyAll, applyOne, resolveForDoc, resultPreviews, runAi, runFor, type AiRunRequest } from "$lib/ai/run";
  import { runOnAll, shootoutProviders } from "$lib/ai/shootout";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import Popover from "$lib/ui/controls/Popover.svelte";
  import PsSelect from "$lib/ui/controls/PsSelect.svelte";
  import ScrubbyNumber from "$lib/ui/controls/ScrubbyNumber.svelte";
  import { aiSections, modeTooltip, progressFraction } from "./ai-panel-ui.svelte";
  import { aiUi, type SizeOption } from "$lib/ai/ui.svelte";
  import { isReady, notReadyNote, onSubscription, type AiMode, type ImageSize, type ProviderId } from "$lib/ai/types";

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
    provider && onSubscription(provider)
      ? { usd: 0, perImage: 0, approx: false, note: "Uses your subscription plan: no per-request API charge (counts toward the plan's limits)." }
      : provider
      ? estimateCost({ provider: provider.id, model: effectiveModel, mode, size: chosenSize, quality: aiUi.quality || undefined, n: aiUi.n, local: provider.local })
      : null,
  );

  const canRun = $derived(Boolean(provider && aiUi.prompt.trim().length > 0 && !busy && ((provider ? isReady(provider) : false) || !hasTauri())));
  const assistants = $derived(assistProviders(aiUi.providers));
  let improving = $state(false);

  // Wave 5 hooks (ai-custom): "Run on all ▸" and "✨ Improve prompt"; the Wave 6 restyle
  // keeps these behind a split-button / icon.
  function runAll(): void {
    notice = null;
    void runOnAll().catch((e: unknown) => {
      notice = { kind: "error", text: e instanceof Error ? e.message : String(e) };
    });
  }

  async function improve(): Promise<void> {
    improving = true;
    notice = null;
    try {
      await improvePrompt();
      notice = { kind: "info", text: `${assistants[0]?.name ?? "Ollama"} rewrote the prompt.` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : ((e as { message?: string }).message ?? String(e));
      notice = { kind: "error", text: msg };
    } finally {
      improving = false;
    }
  }
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
    if (p && !isReady(p) && hasTauri()) {
      openApiKeysDialog({ select: id });
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


  let splitBtn = $state<HTMLButtonElement | null>(null);
  let splitOpen = $state(false);
  const shootoutCount = $derived(shootoutProviders(aiUi.providers).length);
  const modelChoices = $derived([
    { value: "", label: `Default (${isEdit ? provider?.editModel || "–" : provider?.defaultModel || "–"})` },
    ...(provider?.models ?? []).map((m) => ({ value: m, label: m })),
  ]);
  const sizeChoices = $derived(sizeOptions.map((o) => ({ value: o.key, label: o.label })));
  const qualityChoices = $derived([{ value: "", label: "Default" }, ...qualityOptions.map((q) => ({ value: q, label: q }))]);
</script>

<div class="ai" onpaste={onPaste}>
  <div class="top">
    <ProviderPicker providers={aiUi.providers} selected={aiUi.providerId} onselect={pickProvider} onmanage={() => openApiKeysDialog()} />
    <div class="frow">
      <span class="flbl">Model:</span>
      <span class="grow-field"><PsSelect value={aiUi.model} choices={modelChoices} onchange={(v) => (aiUi.model = v)} /></span>
    </div>
    <div class="frow">
      <span class="flbl">Mode:</span>
      <span class="mode" title={modeTooltip(resolution.reason, resolution.emulated)}>{modeLabel}{resolution.emulated ? " (emulated)" : ""}</span>
      {#if aiUi.forcedMode}
        <button type="button" class="textbtn" title="Pick the mode from the selection again" onclick={() => (aiUi.forcedMode = undefined)}>Auto</button>
      {/if}
    </div>
    <div class="flow" title="Every result lands on a new layer, so providers can be chained.">{flow}</div>
  </div>

  {#if aiUi.providersError}
    <p class="notice error">{aiUi.providersError}</p>
  {/if}

  <section class="sec">
    <button type="button" class="sechead" aria-expanded={aiSections.prompt} onclick={() => (aiSections.prompt = !aiSections.prompt)}>
      <Icon name={aiSections.prompt ? "chevron-down" : "chevron-right"} size={10} /> Prompt
    </button>
    {#if aiSections.prompt}
      <div class="secbody">
        <textarea
          bind:this={promptEl}
          bind:value={aiUi.prompt}
          class="input prompt"
          rows="4"
          placeholder={mode === "generate" ? "Describe the image to make…" : mode === "mask" ? "What should change inside the selection?" : "How should the whole image change?"}
          onkeydown={onPromptKey}
          aria-label="Prompt"
        ></textarea>
        <label class="chkrow">
          <input type="checkbox" checked={aiUi.showNegative} onchange={() => (aiUi.showNegative = !aiUi.showNegative)} />
          Avoid{#if !aiUi.showNegative && aiUi.negativePrompt}<span class="dim">: {aiUi.negativePrompt.slice(0, 32)}</span>{/if}
        </label>
        {#if aiUi.showNegative}
          <textarea bind:value={aiUi.negativePrompt} class="input prompt small" rows="2" placeholder="Things to leave out (folded into the prompt)" aria-label="Negative prompt"></textarea>
        {/if}
      </div>
    {/if}
  </section>

  <section class="sec">
    <button type="button" class="sechead" aria-expanded={aiSections.refs} onclick={() => (aiSections.refs = !aiSections.refs)}>
      <Icon name={aiSections.refs ? "chevron-down" : "chevron-right"} size={10} /> Reference images
      <span class="count">{aiUi.refs.length}/{maxRefs}</span>
    </button>
    {#if aiSections.refs}
      <div
        bind:this={dropEl}
        class="secbody refs"
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
            <button type="button" class="rm" aria-label="Remove {r.name}" onclick={() => aiUi.removeRef(r.id)}><Icon name="close-small" size={10} /></button>
          </div>
        {/each}
        {#if aiUi.refs.length < maxRefs}
          <button type="button" class="addref" onclick={() => fileInput?.click()} title="Add reference images (drop, paste or browse)">
            <Icon name="image" size={14} />
            <span>Drop, paste or browse…</span>
          </button>
        {:else}
          <span class="dim">{maxRefs === 0 ? "This provider takes no reference images." : `${maxRefs} of ${maxRefs} references`}</span>
        {/if}
        <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={(e) => void addRefFiles((e.currentTarget as HTMLInputElement).files ?? [])} />
      </div>
    {/if}
  </section>

  <section class="sec">
    <button type="button" class="sechead" aria-expanded={aiSections.options} onclick={() => (aiSections.options = !aiSections.options)}>
      <Icon name={aiSections.options ? "chevron-down" : "chevron-right"} size={10} /> Options
    </button>
    {#if aiSections.options}
      <div class="secbody">
        <div class="frow">
          <span class="flbl">Size:</span>
          <span class="grow-field"><PsSelect value={aiUi.sizeKey} choices={sizeChoices} onchange={(v) => (aiUi.sizeKey = v)} /></span>
        </div>
        <div class="frow">
          <ScrubbyNumber label="Variants" value={aiUi.n} min={1} max={Math.max(1, maxN)} disabled={maxN <= 1} width={32} onchange={(v) => (aiUi.n = Math.round(v))} />
          {#if qualityOptions.length}
            <span class="flbl q">Quality:</span>
            <PsSelect value={aiUi.quality} choices={qualityChoices} width={80} onchange={(v) => (aiUi.quality = v)} />
          {/if}
        </div>
        {#if caps?.transparentBg}
          <label class="chkrow"><input type="checkbox" bind:checked={aiUi.transparent} /> Transparent background</label>
        {/if}
        {#if mode === "generate" && doc}
          <label class="chkrow"><input type="checkbox" bind:checked={aiUi.newDocument} /> New document</label>
        {/if}
      </div>
    {/if}
  </section>

  <section class="sec">
    <button type="button" class="sechead" aria-expanded={aiUi.showAdvanced} onclick={() => (aiUi.showAdvanced = !aiUi.showAdvanced)}>
      <Icon name={aiUi.showAdvanced ? "chevron-down" : "chevron-right"} size={10} /> Advanced
    </button>
    {#if aiUi.showAdvanced}
      <div class="secbody">
        <div class="frow">
          <ScrubbyNumber label="Timeout" value={aiUi.timeoutSecs} min={10} max={3600} step={10} unit="s" width={40} onchange={(v) => (aiUi.timeoutSecs = Math.round(v))} />
          <ScrubbyNumber label="Edge feather" value={aiUi.feather} min={0} max={64} unit="px" width={32} onchange={(v) => (aiUi.feather = Math.round(v))} />
        </div>
      </div>
    {/if}
  </section>

  <div class="run">
    <span class="split">
      <button type="button" class="btn primary runbtn" disabled={!canRun} onclick={run} title="Run (Ctrl+Enter)">{busy ? "Running…" : "Run"}</button>
      <button type="button" class="btn primary caretbtn" bind:this={splitBtn} aria-label="Run on all models" aria-haspopup="menu" aria-expanded={splitOpen} title="Run on all ▸" onclick={() => (splitOpen = !splitOpen)}><Icon name="caret-small" size={12} /></button>
    </span>
    <Popover anchor={splitBtn} open={splitOpen} onclose={() => (splitOpen = false)} minWidth={210}>
      <div class="pmenu" role="menu">
        <button type="button" role="menuitem" class="pitem" disabled={!aiUi.prompt.trim() || shootoutCount === 0} onclick={() => { splitOpen = false; runAll(); }}>
          <span class="plabel">Run on All Models ({shootoutCount})</span><span class="psc">Ctrl+Shift+Alt+M</span>
        </button>
        <button type="button" role="menuitem" class="pitem" onclick={() => { splitOpen = false; openShootoutDialog(null); }}>
          <span class="plabel">Choose Models…</span>
        </button>
      </div>
    </Popover>
    {#if assistants.length}
      <button type="button" class="icon-btn" disabled={improving} data-tip="Improve prompt with {assistants[0]?.name} (never makes an image)" aria-label="Improve prompt" onclick={() => void improve()}><Icon name="ai" size={14} /></button>
    {/if}
    <span class="grow"></span>
    {#if cost}
      <span class="cost" title={cost.note}>{provider?.local ? "Free" : formatUsd(cost.usd, cost.approx)}</span>
    {/if}
  </div>
  {#if provider && !isReady(provider) && hasTauri()}
    <button type="button" class="textbtn keylink" onclick={() => openApiKeysDialog({ select: provider.id })}>{onSubscription(provider) ? `Sign in to ${provider.name} (${notReadyNote(provider)})…` : `Add a ${provider.name} key…`}</button>
  {/if}

  {#if notice}
    <p class="notice" class:error={notice.kind === "error"}>
      <span>{notice.text}</span>
      <button type="button" class="x" aria-label="Dismiss" onclick={() => (notice = null)}><Icon name="close-small" size={10} /></button>
    </p>
  {/if}

  {#if jobStore.jobs.length}
    <ul class="jobs" aria-label="Jobs">
      {#each jobStore.jobs.slice(0, 6) as job (job.id)}
        {@const live = !TERMINAL.has(job.state)}
        {@const frac = progressFraction(job)}
        <li class="job" class:failed={job.state === "failed"}>
          <div class="jrow">
            <span class="jprov">{job.providerName}</span>
            <span class="jprompt" title={job.prompt}>{job.prompt}</span>
            <span class="jstate">{stateLabel(job)} · {elapsed(job)}</span>
            {#if live}
              <button type="button" class="icon-btn sm" data-tip="Cancel" aria-label="Cancel job" onclick={() => void jobStore.cancel(job.id)}><Icon name="stop" size={10} /></button>
            {:else}
              {#if job.state === "completed" && job.docId}
                <button type="button" class="icon-btn sm" data-tip="Toggle diff overlay" aria-label="Toggle diff overlay" onclick={() => showDiff(job)}><Icon name="eye" size={12} /></button>
              {/if}
              <button type="button" class="icon-btn sm" data-tip="Remove" aria-label="Remove job" onclick={() => jobStore.remove(job.id)}><Icon name="close-small" size={10} /></button>
            {/if}
          </div>
          <div class="bar" class:indet={live && frac === null} class:done={job.state === "completed"} class:bad={job.state === "failed"}>
            <span style:width="{(frac ?? (live ? 0.3 : 1)) * 100}%"></span>
          </div>
          {#if job.error}
            <div class="jerr">{job.error.title}{#if job.error.hint}{" "}<span class="dim">{job.error.hint}</span>{/if}</div>
          {/if}
          {#if job.state === "completed" && job.results && job.results.length > 1}
            <div class="variants">
              {#each previews[job.id] ?? [] as url, i (i)}
                <button type="button" class="variant" class:added={job.applied.includes(i)} title="Add variant {i + 1} as a layer" onclick={() => void addVariant(job, i)}>
                  {#if url}<img src={url} alt="Variant {i + 1}" />{:else}<span class="dim">{i + 1}</span>{/if}
                </button>
              {/each}
              <button type="button" class="textbtn" onclick={() => void applyAll(job.id)}>Add all</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ai {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden auto;
    font-size: var(--fs-sm);
    color: var(--ps-text);
  }
  .ai > * {
    flex: none;
  }
  .top {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px 4px;
  }
  .frow {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: var(--row-h);
  }
  .flbl {
    width: 52px;
    flex: none;
    color: var(--ps-text-dim);
  }
  .flbl.q {
    width: auto;
    margin-left: 10px;
  }
  .grow-field {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .grow-field :global(.wrap) {
    flex: 1;
    min-width: 0;
  }
  .grow-field :global(.sel) {
    flex: 1;
    min-width: 0;
  }
  .mode {
    color: var(--ps-text);
    cursor: help;
  }
  .flow {
    padding-left: 56px;
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .textbtn {
    color: var(--ps-text-dim);
    text-decoration: underline;
    text-underline-offset: 2px;
    font-size: var(--fs-xs);
  }
  .textbtn:hover {
    color: var(--ps-text);
  }
  .sec {
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .sechead {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: var(--row-h);
    padding: 0 6px;
    background: var(--ps-panel-head);
    color: var(--ps-text);
    text-align: left;
  }
  .sechead:hover {
    background: var(--ps-hover);
  }
  .count {
    margin-left: auto;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .secbody {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 5px 8px 7px;
  }
  .prompt {
    width: 100%;
    resize: vertical;
    min-height: 60px;
    line-height: 1.4;
  }
  .prompt.small {
    min-height: 34px;
  }
  .chkrow {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
  }
  .dim {
    color: var(--ps-text-disabled);
  }
  .refs {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .refs.over {
    box-shadow: inset 0 0 0 1px var(--ps-accent);
  }
  .ref {
    position: relative;
    width: 36px;
    height: 36px;
    border: 1px solid var(--ps-border-dark);
    background: var(--ps-input);
  }
  .ref img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .rm {
    position: absolute;
    top: 0;
    right: 0;
    display: grid;
    place-items: center;
    width: 12px;
    height: 12px;
    background: var(--ps-panel);
    color: var(--ps-text);
  }
  .addref {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 4px;
    color: var(--ps-text-dim);
  }
  .addref:hover {
    color: var(--ps-text);
    background: var(--ps-hover);
  }
  .run {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .split {
    display: inline-flex;
  }
  .runbtn {
    min-width: 64px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .caretbtn {
    min-width: 0;
    width: 18px;
    padding: 0;
    border-left: 1px solid #0d5bbd;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .grow {
    flex: 1;
  }
  .cost {
    color: var(--ps-text-dim);
    font-variant-numeric: tabular-nums;
  }
  .keylink {
    align-self: flex-start;
    margin: -2px 8px 4px;
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0 8px 6px;
    padding: 4px 6px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    color: var(--ps-text);
  }
  .notice span {
    flex: 1;
  }
  .notice.error {
    color: #ff9a9a;
  }
  .x {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    color: var(--ps-text-dim);
  }
  .jobs {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--ps-border-dark);
  }
  .job {
    padding: 2px 8px 4px;
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .jrow {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 20px;
  }
  .jprov {
    flex: none;
    color: var(--ps-text);
  }
  .jprompt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ps-text-dim);
  }
  .jstate {
    flex: none;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .icon-btn.sm {
    width: 16px;
    height: 16px;
  }
  .bar {
    position: relative;
    height: 2px;
    background: var(--ps-input);
    overflow: hidden;
  }
  .bar span {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--ps-accent);
  }
  .bar.done span {
    background: var(--ps-text-disabled);
  }
  .bar.bad span {
    background: var(--ps-danger);
  }
  .bar.indet span {
    animation: ai-indet 1.2s linear infinite;
  }
  @keyframes ai-indet {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar.indet span {
      animation: none;
    }
  }
  .jerr {
    padding-top: 2px;
    color: #ff9a9a;
  }
  .variants {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    padding-top: 4px;
  }
  .variant {
    width: 40px;
    height: 40px;
    border: 1px solid var(--ps-border-dark);
    background: var(--ps-input);
  }
  .variant img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .variant:hover {
    border-color: var(--ps-text);
  }
  .variant.added {
    outline: 1px solid var(--ps-accent);
    outline-offset: -1px;
  }
  .pmenu {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .pitem {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 12px 0 16px;
    text-align: left;
    white-space: nowrap;
    color: var(--ps-text);
  }
  .pitem:hover:not(:disabled) {
    background: var(--ps-row-selected);
  }
  .pitem:disabled {
    color: var(--ps-text-disabled);
  }
  .plabel {
    flex: 1;
    padding-right: 20px;
  }
  .psc {
    color: var(--ps-text-dim);
  }
</style>
