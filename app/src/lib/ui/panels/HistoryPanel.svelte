<script lang="ts">
  import { docStore } from "$lib/stores/doc.svelte";

  const entry = $derived(docStore.active);
  const view = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    const h = entry.history;
    return { entries: h.entries.slice(), index: h.index, evicted: h.evictedCount, bytes: h.bytes, name: entry.doc.name };
  });

  let list = $state<HTMLDivElement | null>(null);

  // Keep the current step in view as commands are pushed (new steps append at the bottom).
  $effect(() => {
    const el = list;
    const idx = view?.index;
    if (!el || idx === undefined) return;
    queueMicrotask(() => el.querySelector<HTMLElement>(".step.current")?.scrollIntoView({ block: "nearest" }));
  });

  function jump(i: number) {
    if (!entry) return;
    entry.history.jumpTo(i);
    entry.dirty = true;
    entry.version++;
    entry.pixelVersion++;
  }
  function fmtBytes(n: number): string {
    return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
  }
</script>

<div class="history">
  {#if view && entry}
    <div class="list" bind:this={list}>
      {#if view.evicted > 0}
        <div class="evicted">{view.evicted} older step{view.evicted === 1 ? "" : "s"} forgotten to stay under the memory budget</div>
      {/if}
      <button type="button" class="step origin" class:current={view.index === 0} onclick={() => jump(0)}>
        <span class="dot"></span>
        <span class="label">{view.name}</span>
      </button>
      {#each view.entries as e, i (e.seq)}
        <button type="button" class="step" class:current={view.index === i + 1} class:undone={i >= view.index} onclick={() => jump(i + 1)}>
          <span class="dot"></span>
          <span class="label">{e.label}</span>
          {#if e.bytes > 0}<span class="bytes">{fmtBytes(e.bytes)}</span>{/if}
        </button>
      {/each}
    </div>
    <div class="footer">{view.entries.length} step{view.entries.length === 1 ? "" : "s"} · {fmtBytes(view.bytes)}</div>
  {:else}
    <div class="empty">Edits will be listed here. Click any step to go back to it.</div>
  {/if}
</div>

<style>
  .history {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 26px;
    padding: 0 10px;
    text-align: left;
    font-size: var(--fs-sm);
    color: var(--fg-1);
    border-left: 2px solid transparent;
  }
  .step:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .step.current {
    background: var(--accent-soft);
    color: var(--fg-0);
    border-left-color: var(--accent);
  }
  .step.undone {
    color: var(--fg-2);
    font-style: italic;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.5;
  }
  .origin .dot {
    background: var(--accent-2);
    opacity: 1;
  }
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bytes {
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .evicted {
    padding: 6px 10px;
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .footer {
    padding: 4px 10px;
    border-top: 1px solid var(--border);
    color: var(--fg-2);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .empty {
    padding: 14px 10px;
    color: var(--fg-2);
    font-size: var(--fs-sm);
  }
</style>
