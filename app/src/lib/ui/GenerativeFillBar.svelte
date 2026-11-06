<script lang="ts">
  import { onMount } from "svelte";
  import type { Selection } from "$lib/engine";
  import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
  import { aiUi } from "$lib/ai/ui.svelte";
  import { jobStore } from "$lib/ai/jobs.svelte";
  import { isReady, onSubscription, type ProviderId } from "$lib/ai/types";
  import { estimateCost, formatUsd } from "$lib/ai/pricing";
  import { toFriendlyError } from "$lib/ai/errors";
  import ProviderPicker from "$lib/ai/ProviderPicker.svelte";
  import { contextualPosition } from "./contextual-position";

  let { entry, width, height }: { entry: OpenDoc; width: number; height: number } = $props();
  let bar = $state<HTMLFormElement | null>(null);
  let barHeight = $state(102);
  let dismissed = $state<Selection | null>(null);
  let busy = $state(false);
  let notice = $state("");
  let failed = $state(false);
  const barWidth = $derived(Math.min(460, Math.max(64, width - 16)));
  const placement = $derived.by(() => {
    void entry.version;
    const selection = entry.doc.selection;
    if (selection === dismissed || selection.isEmpty || selection.isAll || !selection.bbox) return null;
    return contextualPosition(selection.bbox, entry.viewport, width, height, barWidth, barHeight);
  });
  const provider = $derived(aiUi.provider);
  const offline = $derived(provider?.kind === "lama");
  const expanding = $derived.by(() => {
    void entry.version;
    return aiUi.expansion?.docId === entry.id && aiUi.expansion.selection === entry.doc.selection;
  });
  const removing = $derived.by(() => {
    void entry.version;
    return aiUi.removal?.docId === entry.id && aiUi.removal.selection === entry.doc.selection;
  });
  const model = $derived(provider?.editModel || provider?.defaultModel || "");
  const activeJob = $derived(jobStore.active.find((j) => j.docId === entry.id));
  const compatible = $derived(Boolean(provider && (offline ? provider.capabilities.maskEdit : provider.capabilities.instructEdit && provider.capabilities.maxVariants >= 3)));
  const canRun = $derived(Boolean(placement && provider && isReady(provider) && compatible && (offline || aiUi.prompt.trim()) && !busy && !activeJob));
  const cost = $derived(provider && !onSubscription(provider) ? estimateCost({ provider: provider.id, model, mode: "mask", n: 3, local: provider.local }) : null);

  onMount(() => { if (!aiUi.providersLoaded) void aiUi.refreshProviders(); });
  $effect(() => {
    if (!bar) return;
    const observer = new ResizeObserver(([e]) => { if (e) barHeight = e.borderBoxSize[0]?.blockSize ?? e.contentRect.height; });
    observer.observe(bar);
    return () => observer.disconnect();
  });

  function selectProvider(id: ProviderId): void {
    aiUi.providerId = id;
    aiUi.model = "";
    notice = "";
  }
  async function manage(): Promise<void> {
    const { openAiProvidersDialog } = await import("$lib/ai/dialogs");
    openAiProvidersDialog(provider ? { select: provider.id } : undefined);
  }
  async function generate(): Promise<void> {
    if (!canRun || !provider || docStore.activeId !== entry.id) return;
    busy = true;
    failed = false;
    notice = "";
    const req = {
      provider, model, prompt: offline ? "Remove selected content" : aiUi.prompt.trim(), n: offline ? 1 : 3, refs: [], newDocument: false,
      forcedMode: "mask" as const, generativeFill: !offline, feather: expanding ? 0 : 2,
      selection: entry.doc.selection.clone(),
      ...aiUi.sampling,
    };
    aiUi.lastRun = req;
    try {
      const { runAi } = await import("$lib/ai/run");
      // Import may yield while another document is activated. Never submit its pixels.
      if (docStore.activeId !== entry.id) throw new Error("Return to this document to generate its fill.");
      const run = await runAi(req);
      failed = run.job.state !== "completed";
      notice = failed ? (run.job.error?.detail || "Edit was cancelled.") : offline ? "Offline result added as a new layer." : "Three variants added. Choose one in Properties.";
    } catch (e) {
      failed = true;
      notice = toFriendlyError(e).detail;
    } finally {
      busy = false;
    }
  }
  async function cancel(): Promise<void> {
    if (!activeJob) return;
    try { await jobStore.cancel(activeJob.id); }
    catch (e) { failed = true; notice = toFriendlyError(e).detail; }
  }
</script>

{#if placement}
  <!-- The form owns pointer and keyboard input so editing it cannot paint/select underneath. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form class="fill-bar" aria-label="Selection task bar" bind:this={bar}
    style:left="{placement.x}px" style:top="{placement.y}px" style:width="{barWidth}px"
    onpointerdown={(e) => e.stopPropagation()} onpointermove={(e) => e.stopPropagation()}
    onpointerup={(e) => e.stopPropagation()} onwheel={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    onsubmit={(e) => { e.preventDefault(); void generate(); }}>
    <div class="top">
      <strong>{expanding ? "Generative Expand" : removing ? "Remove" : "Generative Fill"}</strong>
      <span class="details" title={offline ? "Runs on your CPU" : cost?.note ?? "Provider billing and account limits apply"}>{offline ? "1 result · Free · Offline" : `3 variants · ${cost ? formatUsd(cost.usd, cost.approx) : provider && onSubscription(provider) ? "Plan access" : "Provider pricing"}`}</span>
      <button type="button" class="icon-btn" aria-label="Hide selection task bar" title="Hide until the selection changes" onclick={() => (dismissed = entry.doc.selection)}>×</button>
    </div>
    <ProviderPicker providers={aiUi.providers} selected={aiUi.providerId} onselect={selectProvider} onmanage={() => void manage()} />
    <div class="prompt-row">
      {#if offline}<span class="details">Fill the selected area using its surroundings.</span>{:else}<input class="input" aria-label="Generative Fill prompt" placeholder="Describe what should fill the selection…" bind:value={aiUi.prompt} disabled={busy || Boolean(activeJob)} />{/if}
      {#if activeJob}
        <button class="btn" type="button" onclick={() => void cancel()}>Cancel</button>
      {:else}
        <button class="btn primary" type="submit" disabled={!canRun}>{busy ? "Applying…" : offline ? "Remove locally" : "Generate"}</button>
      {/if}
    </div>
    <div class="bottom">
      <span class="details">Default model · Auto size</span>
      <button class="textbtn" type="button" onclick={() => aiUi.focusGenerativeFill()}>More options…</button>
    </div>
    {#if provider && !isReady(provider)}
      <button class="textbtn" type="button" onclick={() => void manage()}>Connect {provider.name} to generate</button>
    {:else if provider && !compatible}
      <p class="message">Choose a provider that supports image editing and three variants.</p>
    {/if}
    {#if aiUi.providersError}<p class="message error">{aiUi.providersError}</p>{/if}
    {#if notice}<p class="message" class:error={failed} role="status">{notice}</p>{/if}
  </form>
{/if}

<style>
  .fill-bar { position: absolute; z-index: 8; box-sizing: border-box; padding: 8px; border: 1px solid var(--ps-border); border-radius: 5px; background: var(--ps-panel-bg, #292929); box-shadow: 0 4px 14px #0008; cursor: default; display: grid; gap: 6px; color: var(--ps-text); }
  .top, .prompt-row, .bottom { display: flex; align-items: center; gap: 8px; }
  .top strong { font-size: 12px; }
  .top .details, .bottom .details { flex: 1; }
  .details { font-size: 11px; color: var(--ps-text-dim); }
  .prompt-row input { flex: 1; min-width: 0; height: 26px; }
  .message { margin: 0; font-size: 11px; overflow-wrap: anywhere; max-height: 90px; overflow-y: auto; user-select: text; }
  .error { color: #ff9a9a; }
</style>
