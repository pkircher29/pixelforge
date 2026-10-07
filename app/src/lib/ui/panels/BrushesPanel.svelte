<script lang="ts">
  /**
   * Brushes panel: size slider, preset groups (disclosure) with stroke thumbnails,
   * bottom bar New / Delete; double-click a user preset to rename it.
   */
  import Icon from "../icons/Icon.svelte";
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import { brushStore } from "$lib/tools/brush-store.svelte";
  import { drawStrokePreview } from "$lib/tools/ui/brush-thumb";
  import type { BrushPreset } from "$lib/tools/brush-presets";

  let collapsed = $state<Record<string, boolean>>({});
  let renaming = $state<string | null>(null);
  let filter = $state("");
  const groups = $derived.by(() => {
    const map = new Map<string, BrushPreset[]>();
    for (const p of brushStore.presets) {
      if (filter && !p.name.toLowerCase().includes(filter.toLowerCase())) continue;
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return [...map.entries()];
  });
  const current = $derived(brushStore.current);

  function thumb(el: HTMLCanvasElement, p: BrushPreset) {
    const draw = () => drawStrokePreview(el, p.settings, { color: "#d6d6d6" });
    draw();
    return { update: draw };
  }
  function create() {
    const n = brushStore.userPresets.length + 1;
    brushStore.saveAsPreset(`Brush ${n}`);
  }
  function del() {
    if (current && !current.builtin) brushStore.deletePreset(current.id);
  }
</script>

<div class="bp">
  <div class="top">
    <ScrubbyNumber label="Size" value={brushStore.settings.size} min={1} max={2500} log unit="px" width={52} onchange={(v) => brushStore.update({ size: v })} />
    <input class="input search" type="search" placeholder="Search brushes" bind:value={filter} onkeydown={(e) => e.stopPropagation()} />
  </div>
  <div class="list">
    {#each groups as [group, presets] (group)}
      <button type="button" class="gh" onclick={() => (collapsed[group] = !collapsed[group])} aria-expanded={!collapsed[group]}>
        <Icon name={collapsed[group] ? "chevron-right" : "chevron-down"} size={12} />
        <Icon name="folder" size={14} />
        <span>{group}</span>
      </button>
      {#if !collapsed[group]}
        {#each presets as p (p.id)}
          <div class="item" class:on={p.id === brushStore.presetId}>
            <button type="button" class="pick" title={p.name} ondblclick={() => !p.builtin && (renaming = p.id)} onclick={() => brushStore.applyPreset(p.id)}>
              <canvas use:thumb={p}></canvas>
              <span class="sz">{Math.round(p.settings.size)}</span>
            </button>
            {#if renaming === p.id}
              <input
                class="input rn"
                value={p.name}
                onkeydown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") { brushStore.renamePreset(p.id, e.currentTarget.value.trim() || p.name); renaming = null; }
                  if (e.key === "Escape") renaming = null;
                }}
                onblur={(e) => { brushStore.renamePreset(p.id, e.currentTarget.value.trim() || p.name); renaming = null; }}
              />
            {:else}
              <span class="nm">{p.name}</span>
            {/if}
          </div>
        {/each}
      {/if}
    {/each}
  </div>
  <div class="bar">
    <span class="grow"></span>
    <button type="button" class="icon-btn" data-tip="Create new brush from the current settings" aria-label="New brush" onclick={create}><Icon name="new-layer" size={16} /></button>
    <button type="button" class="icon-btn" data-tip="Delete brush" aria-label="Delete brush" disabled={!current || current.builtin} onclick={del}><Icon name="trash" size={16} /></button>
  </div>
</div>

<style>
  .bp {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
  }
  .search {
    flex: 1;
    min-width: 0;
  }
  .list {
    flex: 1;
    overflow: auto;
    border-top: 1px solid var(--ps-border-dark);
  }
  .gh {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 22px;
    padding: 0 6px;
    color: var(--ps-text);
    text-align: left;
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 6px 0 22px;
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .item.on {
    background: var(--ps-row-selected);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pick canvas {
    width: 96px;
    height: 26px;
    display: block;
  }
  .sz {
    min-width: 24px;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .nm {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ps-text);
  }
  .rn {
    flex: 1;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    padding: 0 4px;
    border-top: 1px solid var(--ps-border-dark);
  }
  .grow {
    flex: 1;
  }
</style>
