<script lang="ts">
  /**
   * AI History panel: every job recorded on `doc.meta.aiHistory` (schema in
   * `docs/ai-history.md`), newest first. Actions: re-run with another provider, edit the
   * prompt and re-run, reveal the result layer, toggle the diff overlay.
   * Registered by `$lib/ai/register` as panel `ai-history` (group `history`).
   *
   * Photoshop idiom: rows like the History panel (thumb · provider glyph · prompt ·
   * status); hovering a row reveals Re-run / Reveal / Diff icon buttons; click a row for
   * details; shootout entries expand into a strip of per-provider results.
   */
    import { findLayer } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { getHistory, type AiHistoryEntry } from "$lib/ai/history";
  import { isDiffShown, toggleDiffOverlay } from "$lib/ai/overlay";
  import { formatUsd } from "$lib/ai/pricing";
  import { rememberedSelection, revealLayer, runAi, type AiRunRequest } from "$lib/ai/run";
  import { aiUi } from "$lib/ai/ui.svelte";
  import { canGenerate, type ProviderId, type ProviderInfo } from "$lib/ai/types";
  import ProviderGlyph from "$lib/ai/ProviderGlyph.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import PsSelect from "$lib/ui/controls/PsSelect.svelte";

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
    if (e.mode === "shootout") return `Shootout · ${e.kept?.length ?? 0} kept`;
    return e.mode === "generate" ? "Generate" : e.mode === "mask" ? (e.emulated ? "Mask (emulated)" : "Mask") : "Instruct";
  }

  // Wave 5 hook (ai-custom): re-run targets come from the live provider list (custom
  // providers included), not the three built-in ids.
  const rerunTargets = $derived(aiUi.providers.filter(canGenerate));

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

  function glyphFor(id: ProviderId): Pick<ProviderInfo, "id" | "local" | "icon" | "kind"> {
    return aiUi.providers.find((p) => p.id === id) ?? { id, local: false, icon: "cloud", kind: "builtin" };
  }
  function statusLabel(e: AiHistoryEntry): string {
    return e.status === "running" ? "Running" : e.status === "failed" ? "Failed" : e.status === "cancelled" ? "Cancelled" : "";
  }
  const rerunChoices = $derived(rerunTargets.map((p) => ({ value: p.id, label: p.name })));
</script>

<div class="hist">
  {#if !docStore.doc}
    <p class="empty">Open a document to see its AI history.</p>
  {:else if entries.length === 0}
    <p class="empty">Every AI run on this document is listed here and saved with the project.</p>
  {/if}

  {#if notice}
    <p class="notice"><span>{notice}</span><button type="button" class="x" aria-label="Dismiss" onclick={() => (notice = null)}><Icon name="close-small" size={10} /></button></p>
  {/if}

  <ul>
    {#each entries as e (e.id)}
      {@const live = liveLayer(e)}
      <li class="entry" class:open={expanded === e.id} class:failed={e.status === "failed"}>
        <div class="row">
          <button type="button" class="head" onclick={() => (expanded = expanded === e.id ? null : e.id)} aria-expanded={expanded === e.id} title={e.prompt}>
            <span class="thumb">
              {#if e.resultThumbs.find((t) => t)}
                <img src={e.resultThumbs.find((t) => t)} alt="" />
              {:else if e.inputThumb}
                <img src={e.inputThumb} alt="" class="faded" />
              {/if}
            </span>
            <span class="glyph" title={e.providerName}>
              {#if e.mode === "shootout"}<Icon name="ai" size={14} />{:else}<ProviderGlyph provider={glyphFor(e.provider)} />{/if}
            </span>
            <span class="prompt">{e.prompt || "(no prompt)"}</span>
            {#if statusLabel(e)}<span class="st" class:bad={e.status === "failed"}>{statusLabel(e)}</span>{/if}
          </button>
          <span class="acts">
            {#if e.mode !== "shootout"}
              <button type="button" class="icon-btn sm" data-tip="Re-run with {e.providerName}" aria-label="Re-run" onclick={() => void rerun(e, e.prompt, e.provider)}><Icon name="redo" size={12} /></button>
            {/if}
            <button type="button" class="icon-btn sm" data-tip="Reveal layer" aria-label="Reveal layer" disabled={!live} onclick={() => reveal(e)}><Icon name="layers" size={12} /></button>
            <button type="button" class="icon-btn sm" class:on={diffOn(e)} data-tip="Toggle diff overlay" aria-label="Toggle diff overlay" disabled={!live} onclick={() => diff(e)}><Icon name="eye" size={12} /></button>
          </span>
        </div>

        {#if expanded === e.id}
          <div class="body">
            {#if e.mode === "shootout" && e.subResults?.length}
              <div class="strip">
                {#if e.inputThumb}
                  <figure><img src={e.inputThumb} alt="Original" /><figcaption>Original</figcaption></figure>
                {/if}
                {#each e.subResults as sub (sub.provider)}
                  {@const keptHere = (e.kept ?? []).filter((k) => k.provider === sub.provider).map((k) => k.index)}
                  {#each sub.thumbs.length ? sub.thumbs : [""] as t, i (i)}
                    <figure class:kept={keptHere.includes(i)} title="{sub.providerName} · {sub.model}{sub.error ? ` — ${sub.error.message}` : ''}">
                      {#if t}<img src={t} alt="{sub.providerName} {i + 1}" />{:else}<span class="ph">{sub.status === "failed" ? "failed" : "–"}</span>{/if}
                      <figcaption><ProviderGlyph provider={glyphFor(sub.provider)} size={10} />{sub.providerName}{sub.thumbs.length > 1 ? ` ${i + 1}` : ""}</figcaption>
                    </figure>
                  {/each}
                {/each}
              </div>
            {:else}
              <div class="strip">
                {#if e.inputThumb}<figure><img src={e.inputThumb} alt="Input" /><figcaption>Input</figcaption></figure>{/if}
                {#if e.maskThumb}<figure><img src={e.maskThumb} alt="Mask" /><figcaption>Mask</figcaption></figure>{/if}
                {#each e.resultThumbs as t, i (i)}
                  {#if t}<figure><img src={t} alt="Result {i + 1}" /><figcaption>Result{e.resultThumbs.length > 1 ? ` ${i + 1}` : ""}</figcaption></figure>{/if}
                {/each}
              </div>
            {/if}
            <dl class="facts">
              <dt>Provider</dt>
              <dd>{e.providerName}{e.model ? ` · ${e.model}` : ""}</dd>
              <dt>Mode</dt>
              <dd>{modeLabel(e)}</dd>
              <dt>When</dt>
              <dd>{when(e.ts)}{#if e.durationMs}, {(e.durationMs / 1000).toFixed(1)} s{/if}</dd>
              {#if e.size}<dt>Size</dt><dd>{e.size.width} × {e.size.height}</dd>{/if}
              {#if e.n > 1}<dt>Variants</dt><dd>{e.n}</dd>{/if}
              {#if e.costUsd !== undefined}<dt>Cost</dt><dd>{formatUsd(e.costUsd, true)}</dd>{/if}
              {#if e.negativePrompt}<dt>Avoid</dt><dd>{e.negativePrompt}</dd>{/if}
              {#if e.error}<dt>Error</dt><dd class="bad">{e.error.message}</dd>{/if}
            </dl>

            {#if editing === e.id}
              <textarea class="input" bind:value={draft} rows="3" aria-label="Edited prompt"></textarea>
              <div class="actions">
                <button type="button" class="btn sm primary" onclick={() => void rerun(e, draft, rerunProvider[e.id] ?? e.provider)}>Run</button>
                <button type="button" class="btn sm" onclick={() => (editing = null)}>Cancel</button>
              </div>
            {:else if e.mode !== "shootout"}
              <div class="actions">
                <span class="lbl">Re-run with:</span>
                <PsSelect value={rerunProvider[e.id] ?? e.provider} choices={rerunChoices} width={110} onchange={(v) => (rerunProvider[e.id] = v as ProviderId)} />
                <button type="button" class="btn sm" onclick={() => void rerun(e, e.prompt, rerunProvider[e.id] ?? e.provider)}>Run</button>
              </div>
              <div class="actions">
                <button type="button" class="textbtn" onclick={() => startEdit(e)}>Edit prompt…</button>
                <button type="button" class="textbtn" onclick={() => loadIntoPanel(e)}>Load into AI panel</button>
              </div>
            {:else}
              <div class="actions">
                <button type="button" class="textbtn" onclick={() => loadIntoPanel(e)}>Load prompt into AI panel</button>
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
    height: 100%;
    min-height: 0;
    overflow: hidden auto;
    font-size: var(--fs-sm);
    color: var(--ps-text);
  }
  .empty {
    margin: 0;
    padding: 10px;
    color: var(--ps-text-dim);
  }
  .notice {
    display: flex;
    gap: 6px;
    margin: 6px 8px;
    padding: 4px 6px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
  }
  .notice span {
    flex: 1;
  }
  .x {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    color: var(--ps-text-dim);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 2px 0;
  }
  .entry.open > .row {
    background: var(--ps-row-selected);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    height: 30px;
  }
  .row:hover {
    background: var(--ps-hover);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 6px;
    text-align: left;
    color: inherit;
  }
  .thumb {
    display: block;
    width: 32px;
    height: 24px;
    flex: none;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    overflow: hidden;
  }
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb img.faded {
    opacity: 0.45;
  }
  .glyph {
    display: grid;
    place-items: center;
    width: 16px;
    flex: none;
    color: var(--ps-text-dim);
  }
  .prompt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st {
    flex: none;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .st.bad,
  .bad {
    color: #ff9a9a;
  }
  .entry.failed .prompt {
    color: var(--ps-text-dim);
  }
  .acts {
    display: none;
    align-items: center;
    gap: 1px;
    padding-right: 4px;
    background: inherit;
  }
  .row:hover .acts,
  .row:focus-within .acts {
    display: flex;
  }
  .row:hover .st {
    display: none;
  }
  .icon-btn.sm {
    width: 18px;
    height: 18px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px 8px 44px;
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .strip {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  figure {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    flex: none;
  }
  figure img,
  .ph {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    object-fit: contain;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
  }
  figure.kept img {
    outline: 1px solid var(--ps-accent);
    outline-offset: -1px;
  }
  figcaption {
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: 56px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 8px;
    margin: 0;
  }
  dt {
    color: var(--ps-text-dim);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  textarea {
    width: 100%;
    resize: vertical;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .lbl {
    color: var(--ps-text-dim);
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
</style>
