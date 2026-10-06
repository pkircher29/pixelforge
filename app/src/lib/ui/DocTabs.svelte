<script lang="ts">
  /** Document tabs: click to activate, middle-click or × to close, dirty dot. */
  import { X, Plus } from "@lucide/svelte";
  import { docStore } from "$lib/stores/doc.svelte";
  import { runCommand } from "./registry.svelte";
  import { closeDocument } from "./commands/file";
</script>

<div class="tabs" role="tablist" aria-label="Open documents">
  {#each docStore.docs as d (d.id)}
    {@const active = d.id === docStore.activeId}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab"
      class:active
      role="tab"
      tabindex="0"
      aria-selected={active}
      onclick={() => docStore.activate(d.id)}
      onkeydown={(e) => e.key === "Enter" && docStore.activate(d.id)}
      onauxclick={(e) => e.button === 1 && void closeDocument(d.id)}
    >
      <span class="name">{d.name}</span>
      {#if d.dirty}<span class="dot" title="Unsaved changes"></span>{/if}
      <button type="button" class="close" aria-label="Close {d.name}" onclick={(e) => { e.stopPropagation(); void closeDocument(d.id); }}>
        <X size={11} />
      </button>
    </div>
  {/each}
  <button type="button" class="new" data-tip="New document  Ctrl+N" aria-label="New document" onclick={() => void runCommand("file.new")}>
    <Plus size={13} />
  </button>
</div>

<style>
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: var(--tabs-h);
    padding: 4px 8px 0;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: calc(var(--tabs-h) - 4px);
    padding: 0 6px 0 12px;
    max-width: 220px;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    color: var(--fg-1);
    font-size: var(--fs-sm);
    transition: background var(--t-fast) ease-out, color var(--t-fast) ease-out;
    outline: none;
  }
  .tab:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .tab.active {
    background: var(--bg-0);
    color: var(--fg-0);
    box-shadow: inset 0 1px 0 var(--border-strong), inset 1px 0 0 var(--border), inset -1px 0 0 var(--border);
  }
  .tab.active::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    top: 0;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-2);
  }
  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: var(--fg-2);
    opacity: 0;
    transition: opacity var(--t-fast) ease-out, background var(--t-fast) ease-out;
  }
  .tab:hover .close,
  .tab.active .close,
  .tab:focus-visible .close {
    opacity: 1;
  }
  .close:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .new {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin: 0 0 3px 4px;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
  }
  .new:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }
</style>
