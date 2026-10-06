<script lang="ts">
  /**
   * AI History panel: every job recorded on `doc.meta.aiHistory` (schema in
   * `docs/ai-history.md`), newest first. Actions: re-run with another provider, edit the
   * prompt and re-run, reveal the result layer, toggle the diff overlay.
   * Registered by `$lib/ai/register` as panel `ai-history` (right dock, order 35).
   */
  import { ChevronDown, ChevronRight, Eye, Pencil, RotateCcw, ScanEye } from "@lucide/svelte";
  import { findLayer } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { getHistory, type AiHistoryEntry } from "$lib/ai/history";
  import { isDiffShown, toggleDiffOverlay } from "$lib/ai/overlay";
  import { formatUsd } from "$lib/ai/pricing";
  import { rememberedSelection, revealLayer, runAi, type AiRunRequest } from "$lib/ai/run";
  import { aiUi } from "$lib/ai/ui.svelte";
  import { PROVIDER_LABEL, PROVIDER_IDS, type ProviderId } from "$lib/ai/types";

  let expanded = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let rerunProvider = $state<Record<string, ProviderId>>({});
  let notice = $state<string | null>(null);

  const version = $derived(docStore.active?.version ?? -1);
  // History entries are plain objects mutated in place (`updateEntry`); a keyed `{#each}`
  // over the same object references would not notice `status` flipping from "running" to
  // "completed", so hand the template fresh shallow copies on every document version.
  const entries = $derived.by((): AiHistoryEntry[] => {
    void version;
    const doc = docStore.doc;
    return doc ? getHistory(doc).map((e) => ({ ...e })).reverse() : [];
  });

  function when(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function modeLabel(e: AiHistoryEntry): string {
    return e.mode === "generate" ? "Generate" : e.mode === "mask" ? (e.emulated ? "Mask (emulated)" : "Mask") : "Instruct";
  }

  function liveLayer(e: AiHistoryEntry): string | null {
    const doc = docStore.doc;
    if (!doc) return null;
    for (let i = e.resultLayerIds.length - 1; i >= 0; i--) {
      const id = e.resultLayerIds[i]!;
      if (findLayer(doc, id)) return id;
    }
    return null;
  }

  function diffOn(e: AiHistoryEntry): boolean {
    void version;
    const doc = docStore.doc;
    const id = liveLayer(e);
    return Boolean(doc && id && isDiffShown(doc, id));
  }

  function reveal(e: AiHistoryEntry): void {
    const id = liveLayer(e);
    if (!id) {
      notice = "That layer was deleted.";
      return;
    }
    revealLayer(id);
  }

  function diff(e: AiHistoryEntry): void {
    const open = docStore.active;
    const id = liveLayer(e);
    if (!open || !id) {
      notice = "That layer was deleted.";
      return;
    }
    toggleDiffOverlay(open, id);
  }

  async function rerun(e: AiHistoryEntry, prompt: string, providerId: ProviderId): Promise<void> {
    const provider = aiUi.providers.find((p) => p.id === providerId);
    if (!provider) {
      notice = "Providers are not loaded yet.";
      return;
    }
    notice = null;
    const remembered = rememberedSelection(e.id);
    const req: AiRunRequest = {
      provider,
      model: providerId === e.provider ? e.model : provider.defaultModel,
      prompt,
      negativePrompt: e.negativePrompt,
      size: providerId === e.provider ? e.size : undefined,
      n: Math.min(e.n, provider.capabilities.maxVariants),
      quality: providerId === e.provider ? e.quality : undefined,
      transparent: e.transparent && provider.capabilities.transparentBg,
      refs: [],
      newDocument: false,
      forcedMode: e.mode === "generate" ? "generate" : e.mode === "instruct" ? "instruct" : undefined,
      feather: aiUi.feather,
      selection: e.mode === "mask" ? remembered : undefined,
    };
    if (e.mode === "mask" && !remembered) notice = "The original selection is not in memory; using the current selection.";
    aiUi.lastRun = req;
    editing = null;
    try {
      const r = await runAi(req);
      if (r.job.state === "failed" && r.job.error) notice = `${r.job.error.title} ${r.job.error.hint}`.trim();
    } catch (err) {
      notice = err instanceof Error ? err.message : String(err);
    }
  }

  function startEdit(e: AiHistoryEntry): void {
    editing = e.id;
    draft = e.prompt;
    expanded = e.id;
  }

  function loadIntoPanel(e: AiHistoryEntry): void {
    aiUi.prompt = e.prompt;
    aiUi.negativePrompt = e.negativePrompt ?? "";
    aiUi.providerId = e.provider;
    aiUi.model = e.model;
    aiUi.focusPrompt(e.mode === "generate" ? "generate" : undefined);
  }
</script>

<div class="hist">
  {#if !docStore.doc}
    <p class="empty">Open a document to see its AI history.</p>
  {:else if entries.length === 0}
    <p class="empty">Nothing yet. Every AI run on this document is recorded here and saved with the project.</p>
  {/if}

  {#if notice}
    <p class="notice">{notice} <button type="button" class="link" onclick={() => (notice = null)}>ok</button></p>
  {/if}

  <ul>
    {#each entries as e (e.id)}
      <li class="entry" class:open={expanded === e.id} class:failed={e.status === "failed"}>
        <button type="button" class="head" onclick={() => (expanded = expanded === e.id ? null : e.id)} aria-expanded={expanded === e.id}>
          {#if expanded === e.id}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
          <span class="thumbs">
            {#if e.resultThumbs[0]}
              <img src={e.resultThumbs[0]} alt="" />
            {:else if e.inputThumb}
              <img src={e.inputThumb} alt="" class="dim" />
            {:else}
              <span class="ph"></span>
            {/if}
          </span>
          <span class="meta">
            <span class="line1">
              <span class="prov">{e.providerName}</span>
              <span class="mode">{modeLabel(e)}</span>
              {#if e.status === "running"}<span class="st run">running</span>{/if}
              {#if e.status === "failed"}<span class="st bad">failed</span>{/if}
              {#if e.status === "cancelled"}<span class="st">cancelled</span>{/if}
            </span>
            <span class="prompt">{e.prompt}</span>
          </span>
        </button>

        {#if expanded === e.id}
          <div class="body">
            <div class="pics">
              {#if e.inputThumb}<figure><img src={e.inputThumb} alt="Input" /><figcaption>input</figcaption></figure>{/if}
              {#if e.maskThumb}<figure><img src={e.maskThumb} alt="Mask" /><figcaption>mask</figcaption></figure>{/if}
              {#each e.resultThumbs as t, i (i)}
                {#if t}<figure><img src={t} alt="Result {i + 1}" /><figcaption>result{e.resultThumbs.length > 1 ? ` ${i + 1}` : ""}</figcaption></figure>{/if}
              {/each}
            </div>
            <dl class="facts">
              <dt>Model</dt>
              <dd>{e.model}</dd>
              <dt>When</dt>
              <dd>{when(e.ts)}{#if e.durationMs}, {(e.durationMs / 1000).toFixed(1)} s{/if}</dd>
              {#if e.size}<dt>Size</dt><dd>{e.size.width} x {e.size.height}</dd>{/if}
              {#if e.n > 1}<dt>Variants</dt><dd>{e.n}</dd>{/if}
              {#if e.costUsd !== undefined}<dt>Cost</dt><dd>{formatUsd(e.costUsd, true)}</dd>{/if}
              {#if e.negativePrompt}<dt>Avoid</dt><dd>{e.negativePrompt}</dd>{/if}
              {#if e.error}<dt>Error</dt><dd class="bad">{e.error.message}</dd>{/if}
            </dl>

            {#if editing === e.id}
              <textarea bind:value={draft} rows="3" aria-label="Edited prompt"></textarea>
              <div class="actions">
                <button type="button" class="btn primary" onclick={() => void rerun(e, draft, rerunProvider[e.id] ?? e.provider)}>Run</button>
                <button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
              </div>
            {:else}
              <div class="actions">
                <label class="rerun">
                  <RotateCcw size={12} />
                  <span>Re-run with</span>
                  <select bind:value={rerunProvider[e.id]}>
                    {#each PROVIDER_IDS as id (id)}
                      <option value={id} selected={id === e.provider}>{aiUi.providers.find((p) => p.id === id)?.name ?? PROVIDER_LABEL[id]}</option>
                    {/each}
                  </select>
                  <button type="button" class="btn" onclick={() => void rerun(e, e.prompt, rerunProvider[e.id] ?? e.provider)}>Go</button>
                </label>
                <button type="button" class="btn" onclick={() => startEdit(e)}><Pencil size={12} /> Edit prompt</button>
                <button type="button" class="btn" onclick={() => loadIntoPanel(e)}>Load into panel</button>
                <button type="button" class="btn" disabled={!liveLayer(e)} onclick={() => reveal(e)}><Eye size={12} /> Reveal layer</button>
                <button type="button" class="btn" class:on={diffOn(e)} disabled={!liveLayer(e)} onclick={() => diff(e)}><ScanEye size={12} /> Diff</button>
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .hist {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    font-size: var(--fs-sm);
    color: var(--fg-1);
    overflow-y: auto;
    min-height: 0;
    height: 100%;
  }
  .hist > * {
    flex: none;
  }
  .empty {
    margin: 0;
    color: var(--fg-2);
    line-height: 1.5;
  }
  .notice {
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-2);
    border-left: 2px solid var(--accent-2);
    color: var(--fg-0);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .entry {
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-2);
  }
  .entry.open {
    border-color: var(--border-strong);
  }
  .entry.failed {
    border-color: rgba(255, 92, 122, 0.4);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px;
    text-align: left;
    color: var(--fg-2);
  }
  .thumbs {
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-3);
  }
  .thumbs img,
  .ph {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumbs img.dim {
    opacity: 0.5;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .line1 {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .prov {
    font-weight: 600;
    color: var(--fg-0);
  }
  .mode {
    color: var(--fg-1);
    font-size: var(--fs-xs);
  }
  .st {
    font-size: var(--fs-xs);
    padding: 0 5px;
    border-radius: 999px;
    background: var(--bg-3);
  }
  .st.run {
    color: var(--accent-2);
  }
  .st.bad,
  .bad {
    color: var(--danger);
  }
  .prompt {
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    padding: 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pics {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
  }
  figure img {
    width: 72px;
    height: 72px;
    object-fit: contain;
    border-radius: var(--radius-sm);
    background: var(--bg-0);
  }
  figcaption {
    font-size: var(--fs-xs);
    color: var(--fg-2);
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    font-size: var(--fs-xs);
  }
  dt {
    color: var(--fg-2);
  }
  dd {
    margin: 0;
    color: var(--fg-1);
    overflow-wrap: anywhere;
  }
  textarea {
    width: 100%;
    font: inherit;
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    resize: vertical;
    user-select: text;
    -webkit-user-select: text;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .rerun {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  select {
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--fg-0);
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px 4px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-3);
    color: var(--fg-1);
    font-size: var(--fs-xs);
  }
  .btn:hover:not(:disabled) {
    color: var(--fg-0);
    background: var(--border-strong);
  }
  .btn:disabled {
    opacity: 0.4;
  }
  .btn.on {
    color: #fff;
    background: #ff00c8;
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
  }
  .link {
    color: var(--accent-2);
    font-size: var(--fs-xs);
  }
</style>
