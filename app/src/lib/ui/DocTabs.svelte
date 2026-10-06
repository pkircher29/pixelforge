<script lang="ts">
  /** PS document tabs: flat on #323232, active #474747, "Name @ 66.7% (Layer 1, RGB/8) *", × on hover. */
  import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
  import { closeDocument } from "./commands/file";
  import { docTitle } from "./doc-title";
  import Icon from "./icons/Icon.svelte";

  function title(d: OpenDoc): string {
    void d.version;
    return docTitle(d, { dirtyMark: true });
  }
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
      title={d.path ?? d.name}
      onclick={() => docStore.activate(d.id)}
      onkeydown={(e) => e.key === "Enter" && docStore.activate(d.id)}
      onauxclick={(e) => e.button === 1 && void closeDocument(d.id)}
    >
      <span class="name">{title(d)}</span>
      <button type="button" class="close" aria-label="Close {d.name}" onclick={(e) => { e.stopPropagation(); void closeDocument(d.id); }}>
        <Icon name="close-small" size={12} />
      </button>
    </div>
  {/each}
  <div class="fill"></div>
</div>

<style>
  .tabs {
    display: flex;
    align-items: stretch;
    height: var(--tabs-h);
    background: var(--ps-app);
    border-bottom: 1px solid var(--ps-border-dark);
    overflow-x: auto;
    overflow-y: hidden;
  }
  .tabs::-webkit-scrollbar {
    height: 0;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    padding: 0 4px 0 8px;
    max-width: 280px;
    color: var(--ps-text-dim);
    font-size: var(--fs-sm);
    border-right: 1px solid var(--ps-border-dark);
    box-shadow: inset -1px 0 0 var(--ps-border-light);
    outline: none;
  }
  .tab:hover {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .tab.active {
    background: var(--ps-active);
    color: var(--ps-text);
    box-shadow: inset -1px 0 0 var(--ps-border-light), inset 0 1px 0 var(--ps-border-light);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 2px;
    color: var(--ps-text-dim);
    opacity: 0;
  }
  .tab:hover .close,
  .tab.active .close,
  .tab:focus-visible .close {
    opacity: 1;
  }
  .close:hover {
    background: var(--ps-row-selected);
    color: var(--ps-text);
  }
  .fill {
    flex: 1;
    box-shadow: inset 0 -1px 0 var(--ps-border-light);
  }
</style>
