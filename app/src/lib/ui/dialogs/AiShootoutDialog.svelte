<script lang="ts">
  /**
   * Multi-model shootout gallery (PLAN-v2 §1c). Two phases: without a session it shows
   * the setup (prompt from the panel, provider checklist persisted in settings, variants);
   * with a session it shows the grid: one column per provider (plus the original in edit
   * modes), one card per variant, hover zoom, click = lightbox with A/B flip, per-card
   * checkboxes, column select-all, retry on failed cards, and the footer actions.
   * Mounted on `document.body` by `$lib/ai/dialogs`. Flat, dense markup.
   */
  import { onDestroy, onMount } from "svelte";
  import { jobStore } from "$lib/ai/jobs.svelte";
  import { formatUsd } from "$lib/ai/pricing";
  import { columnKeys, createShootout, requestFromPanel, setShootoutExcluded, shootoutExcluded, type ShootoutColumn, type ShootoutSession } from "$lib/ai/shootout";
  import { aiUi } from "$lib/ai/ui.svelte";
  import { canGenerate, isReady, type ProviderId } from "$lib/ai/types";

  interface Props {
    session: ShootoutSession | null;
    onclose: () => void;
  }
  const props: Props = $props();

  // Set in onMount from `props.session` (a session is a plain class, not reactive state).
  let session = $state<ShootoutSession | null>(null);
  let version = $state(0);
  let selected = $state<Record<string, boolean>>({});
  let lightbox = $state<{ a: string; b: string | null; showB: boolean } | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);
  let unsubscribe: (() => void) | null = null;

  // Setup phase
  let prompt = $state(aiUi.prompt);
  let n = $state(aiUi.n);
  let excluded = $state<ProviderId[]>(shootoutExcluded());
  const candidates = $derived(aiUi.providers.filter(canGenerate));
  const enabled = $derived(candidates.filter((p) => isReady(p) && !excluded.includes(p.id)));

  function attach(s: ShootoutSession): void {
    unsubscribe?.();
    session = s;
    selected = {};
    unsubscribe = s.subscribe(() => version++);
  }

  onMount(() => {
    void aiUi.refreshProviders();
    if (props.session) attach(props.session);
  });
  onDestroy(() => unsubscribe?.());

  async function start(): Promise<void> {
    notice = null;
    aiUi.prompt = prompt;
    aiUi.n = n;
    await setShootoutExcluded(excluded);
    try {
      attach(await createShootout({ ...requestFromPanel(), prompt, n }, enabled));
    } catch (e) {
      notice = e instanceof Error ? e.message : String(e);
    }
  }

  function toggleExcluded(id: ProviderId): void {
    excluded = excluded.includes(id) ? excluded.filter((x) => x !== id) : [...excluded, id];
  }

  // The session mutates plain objects in place and bumps `version`; hand the template
  // fresh shallow copies so keyed blocks see the change (same reference = no re-render).
  const columns = $derived.by((): ShootoutColumn[] => {
    void version;
    return (session?.columns ?? []).map((c) => ({ ...c, cards: c.cards.map((k) => ({ ...k })) }));
  });
  const selectedKeys = $derived(Object.entries(selected).filter(([, v]) => v).map(([k]) => k));
  const gridCols = $derived((session?.isEdit ? 1 : 0) + columns.length);

  function toggle(key: string): void {
    selected = { ...selected, [key]: !selected[key] };
  }
  function selectColumn(c: ShootoutColumn, on: boolean): void {
    const next = { ...selected };
    for (const k of columnKeys(c)) next[k] = on;
    selected = next;
  }
  function columnAllSelected(c: ShootoutColumn): boolean {
    const keys = columnKeys(c);
    return keys.length > 0 && keys.every((k) => selected[k]);
  }
  function stateLabel(c: ShootoutColumn): string {
    void version;
    void jobStore.now;
    switch (c.state) {
      case "pending":
        return "waiting";
      case "submitting":
        return "sending";
      case "queued":
        return "queued";
      case "running":
        return "running";
      case "completed":
        return "done";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
    }
  }
  function elapsed(c: ShootoutColumn): string {
    void jobStore.now;
    void version;
    const ms = session?.elapsedMs(c) ?? 0;
    return ms ? `${(ms / 1000).toFixed(1)} s` : "";
  }
  function cost(c: ShootoutColumn): string {
    void version;
    if (c.provider.local) return "free";
    const usd = session?.costUsd(c);
    return usd === null || usd === undefined ? "—" : formatUsd(usd, true);
  }
  function isActive(c: ShootoutColumn): boolean {
    return c.state === "submitting" || c.state === "queued" || c.state === "running" || c.state === "pending";
  }
  function openLightbox(key: string): void {
    if (lightbox && lightbox.a !== key) lightbox = { ...lightbox, b: key, showB: true };
    else lightbox = { a: key, b: null, showB: false };
  }
  function lightboxSrc(): string | null {
    if (!lightbox || !session) return null;
    const key = lightbox.showB && lightbox.b ? lightbox.b : lightbox.a;
    return session.card(key)?.preview ?? null;
  }
  function lightboxLabel(): string {
    if (!lightbox || !session) return "";
    const key = lightbox.showB && lightbox.b ? lightbox.b : lightbox.a;
    const card = session.card(key);
    return card ? `${lightbox.showB ? "B" : "A"}: ${card.provider.name} #${card.index + 1}` : "";
  }

  async function act(fn: () => Promise<unknown>, done: string): Promise<void> {
    busy = true;
    notice = null;
    try {
      await fn();
      notice = done;
    } catch (e) {
      notice = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  function keepLayers(): void {
    if (!session) return;
    const s = session;
    const keys = selectedKeys;
    void act(() => s.keepAsLayers(keys), `${keys.length} kept as layer${keys.length === 1 ? "" : "s"}.`).then(() => (selected = {}));
  }
  function keepDocs(): void {
    if (!session) return;
    const s = session;
    const keys = selectedKeys;
    void act(() => s.keepAsDocuments(keys), `${keys.length} opened as new document${keys.length === 1 ? "" : "s"}.`).then(() => (selected = {}));
  }
  function keepRerun(): void {
    if (!session) return;
    const s = session;
    const keys = selectedKeys;
    void act(() => s.keepAndRerunUnselected(keys), "Kept the selection; re-rolling the rest.").then(() => (selected = {}));
  }
  function discard(): void {
    if (session) void session.discard();
    props.onclose();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (lightbox) lightbox = null;
      else props.onclose();
    } else if (lightbox && (e.key === " " || e.key === "Tab") && lightbox.b) {
      e.preventDefault();
      lightbox = { ...lightbox, showB: !lightbox.showB };
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && props.onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="shootout-title">
    <header>
      <h2 id="shootout-title">Generate with all models</h2>
      {#if session}
        <span class="muted">{session.mode === "generate" ? "Generate" : session.mode === "mask" ? "Mask edit" : "Instruct edit"} · {columns.length} provider{columns.length === 1 ? "" : "s"} · "{session.request.prompt.slice(0, 60)}"</span>
      {/if}
      <button type="button" class="icon" aria-label="Close" onclick={props.onclose}>✕</button>
    </header>

    {#if !session}
      <div class="setup">
        <label class="field"><span>Prompt</span><textarea rows="3" bind:value={prompt} placeholder="One prompt, every model"></textarea></label>
        <div class="row">
          <label class="field"><span>Variants per model</span><input type="number" min="1" max="4" bind:value={n} /></label>
          <span class="muted">Mode follows the AI panel: with a selection every model gets the same composite + mask; with none, the whole image or a plain generate.</span>
        </div>
        <div class="field">
          <span>Providers ({enabled.length} enabled)</span>
          <div class="checks">
            {#each candidates as p (p.id)}
              <label class="check" class:off={!isReady(p)} title={isReady(p) ? "" : "No key yet (Edit > AI Providers)"}>
                <input type="checkbox" checked={isReady(p) && !excluded.includes(p.id)} disabled={!isReady(p)} onchange={() => toggleExcluded(p.id)} />
                {p.local ? "🖥 " : ""}{p.name}{isReady(p) ? "" : " (no key)"}
              </label>
            {/each}
            {#if !candidates.length}<span class="muted">No providers can generate yet.</span>{/if}
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn primary" disabled={!prompt.trim() || !enabled.length} onclick={() => void start()}>Run on {enabled.length}</button>
          <button type="button" class="btn" onclick={props.onclose}>Cancel</button>
        </div>
      </div>
    {:else}
      <div class="grid" style="grid-template-columns: repeat({gridCols}, minmax(170px, 1fr));">
        {#if session.isEdit}
          <div class="col">
            <div class="head"><span class="pname">Original</span><span class="muted">input</span></div>
            <div class="card static">
              {#if session.originalThumb}<img src={session.originalThumb} alt="Original composite" />{:else}<span class="muted">…</span>{/if}
            </div>
          </div>
        {/if}
        {#each columns as c (c.provider.id)}
          <div class="col" class:failed={c.state === "failed"}>
            <div class="head">
              <input type="checkbox" title="Select all in this column" checked={columnAllSelected(c)} disabled={columnKeys(c).length === 0} onchange={(e) => selectColumn(c, (e.currentTarget as HTMLInputElement).checked)} />
              <span class="pname" title={c.provider.vendor}>{c.provider.local ? "🖥 " : ""}{c.provider.name}</span>
              <span class="state" class:live={isActive(c)}>{stateLabel(c)}{c.emulated ? " · emulated" : ""}</span>
            </div>
            <div class="meta">
              <span>{c.run?.req.model || c.provider.defaultModel || ""}</span>
              <span>{elapsed(c)}</span>
              <span>{cost(c)}</span>
              {#if isActive(c) && c.run}
                <button type="button" class="link" onclick={() => void jobStore.cancel(c.run!.job.id)}>cancel</button>
              {:else if c.state === "failed" || c.state === "cancelled"}
                <button type="button" class="link" onclick={() => void session?.retry(c.provider.id)}>retry</button>
              {:else if c.state === "completed"}
                <button type="button" class="link" title="Re-roll this provider" onclick={() => void session?.retry(c.provider.id)}>re-roll</button>
              {/if}
            </div>
            {#if c.error}
              <div class="err" title={c.error.detail}>{c.error.title} <span class="muted">{c.error.hint}</span></div>
            {/if}
            {#each c.cards as card (card.key + ":" + c.attempt)}
              <div class="card" class:on={selected[card.key]} class:kept={card.kept !== null}>
                {#if card.preview}
                  <button type="button" class="img" onclick={() => openLightbox(card.key)} title="Click to enlarge; click another card for A/B"><img src={card.preview} alt="{c.provider.name} variant {card.index + 1}" /></button>
                  <label class="pick"><input type="checkbox" checked={selected[card.key] ?? false} disabled={card.kept !== null} onchange={() => toggle(card.key)} /> #{card.index + 1}{card.kept ? ` · kept as ${card.kept}` : ""}</label>
                {:else if c.state === "failed" || c.state === "cancelled"}
                  <span class="muted">no result</span>
                {:else}
                  <span class="spinner" aria-label="Working"></span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
      <footer>
        <span class="muted">{selectedKeys.length} selected{session.done ? "" : " · still running"}</span>
        <span class="grow"></span>
        {#if notice}<span class="notice">{notice}</span>{/if}
        <button type="button" class="btn primary" disabled={busy || !selectedKeys.length || session.docId === null} title={session.docId === null ? "No document open: use Keep as new documents" : ""} onclick={keepLayers}>Keep as layers</button>
        <button type="button" class="btn" disabled={busy || !selectedKeys.length} onclick={keepDocs}>Keep as new documents</button>
        <button type="button" class="btn" disabled={busy || !session.done} title="Keep the selection as layers, re-roll everything else" onclick={keepRerun}>Keep &amp; re-run unselected</button>
        <button type="button" class="btn danger" disabled={busy} onclick={discard}>Discard</button>
      </footer>
    {/if}

    {#if lightbox}
      <div class="lightbox" role="presentation" onclick={() => (lightbox = null)}>
        {#if lightboxSrc()}<img src={lightboxSrc()} alt={lightboxLabel()} />{/if}
        <div class="lb-bar" role="presentation" onclick={(e) => e.stopPropagation()}>
          <span>{lightboxLabel()}</span>
          {#if lightbox.b}
            <button type="button" class="btn" onclick={() => lightbox && (lightbox = { ...lightbox, showB: !lightbox.showB })}>Flip A/B (space)</button>
          {:else}
            <span class="muted">click another card to compare</span>
          {/if}
          <button type="button" class="btn" onclick={() => (lightbox = null)}>Close</button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); }
  .dialog { position: relative; width: min(1100px, calc(100vw - 24px)); max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: var(--bg-1); border: 1px solid var(--border-strong); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6); color: var(--fg-1); font-size: 11px; }
  header { display: flex; align-items: center; gap: 10px; height: 28px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--border); }
  h2 { margin: 0; font-size: 12px; font-weight: 600; color: var(--fg-0); white-space: nowrap; }
  header .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .setup { padding: 10px; display: flex; flex-direction: column; gap: 8px; min-width: 520px; }
  .row { display: flex; gap: 10px; align-items: flex-end; }
  .field { display: flex; flex-direction: column; gap: 2px; }
  .field > span:first-child { color: var(--fg-2); font-size: 10px; }
  .checks { display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .check { display: inline-flex; align-items: center; gap: 4px; height: 22px; }
  .check.off { color: var(--fg-2); }
  input, textarea { font: inherit; font-size: 11px; color: var(--fg-0); background: var(--bg-0); border: 1px solid var(--border-strong); border-radius: 2px; padding: 2px 5px; user-select: text; -webkit-user-select: text; }
  input[type="number"] { height: 18px; width: 60px; }
  textarea { resize: vertical; }
  .grid { display: grid; gap: 6px; padding: 8px; overflow: auto; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .col.failed .head { color: var(--danger, #ff5c7a); }
  .head { display: flex; align-items: center; gap: 5px; height: 22px; border-bottom: 1px solid var(--border); }
  .pname { font-weight: 600; color: var(--fg-0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .state { font-size: 10px; color: var(--fg-2); white-space: nowrap; }
  .state.live { color: var(--accent-2, var(--accent)); }
  .meta { display: flex; gap: 6px; font-size: 10px; color: var(--fg-2); white-space: nowrap; overflow: hidden; }
  .meta span:first-child { overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .err { font-size: 10px; color: var(--danger, #ff5c7a); overflow: hidden; text-overflow: ellipsis; }
  .card { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 160px; background: var(--bg-0); border: 1px solid var(--border); }
  .card.on { border-color: var(--accent); }
  .card.kept { opacity: 0.75; }
  .card.static { min-height: 160px; }
  .card img { display: block; max-width: 100%; max-height: 160px; object-fit: contain; transition: transform 80ms; }
  .img { display: block; width: 100%; padding: 0; background: none; cursor: zoom-in; }
  .img:hover img { transform: scale(1.4); position: relative; z-index: 3; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6); }
  .pick { position: absolute; left: 4px; bottom: 4px; display: inline-flex; align-items: center; gap: 4px; padding: 1px 5px; background: rgba(0, 0, 0, 0.65); color: #fff; border-radius: 2px; font-size: 10px; }
  .spinner { width: 14px; height: 14px; border: 2px solid var(--fg-2); border-top-color: transparent; border-radius: 50%; animation: shootout-spin 0.9s linear infinite; }
  @keyframes shootout-spin { to { transform: rotate(360deg); } }
  footer { display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 8px; border-top: 1px solid var(--border); }
  .grow { flex: 1; }
  .notice { color: var(--fg-0); margin-right: 8px; }
  .actions { display: flex; gap: 4px; }
  .btn { height: 20px; padding: 0 8px; border-radius: 2px; background: var(--bg-3); color: var(--fg-1); border: 1px solid var(--border); white-space: nowrap; }
  .btn:hover:not(:disabled) { color: var(--fg-0); }
  .btn:disabled { opacity: 0.4; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.danger:hover:not(:disabled) { color: var(--danger, #ff5c7a); }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 18px; border-radius: 2px; color: var(--fg-2); }
  .icon:hover { color: var(--fg-0); background: var(--bg-3); }
  .link { color: var(--accent-2, var(--accent)); font-size: 10px; }
  .link:hover { text-decoration: underline; }
  .muted { color: var(--fg-2); }
  .lightbox { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: rgba(0, 0, 0, 0.85); cursor: zoom-out; }
  .lightbox img { max-width: 92%; max-height: calc(100% - 50px); object-fit: contain; }
  .lb-bar { display: flex; align-items: center; gap: 8px; color: var(--fg-0); cursor: default; }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } .card img { transition: none; } }
</style>
