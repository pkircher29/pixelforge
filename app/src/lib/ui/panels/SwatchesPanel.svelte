<script lang="ts">
  /**
   * Swatches panel (PS CC 2020+): search field, the flat default grid, collapsible
   * group folders, and the [new group] [new swatch] [delete] bar. Click = foreground,
   * Ctrl-click = background, Alt-click = delete. Right-click a swatch for rename /
   * delete. Import / export (≡ menu) is Pixelforge's own `.json`; ASE / ACO are not supported.
   */
  import { toolStore } from "$lib/stores/tool.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { toast } from "$lib/stores/toast.svelte";
  import { contextMenu } from "../context-menu.svelte";
  import { openDialog } from "../dialogs/dialogs.svelte";
  import Icon from "../icons/Icon.svelte";
  import HistorySnapshotDialog from "./HistorySnapshotDialog.svelte";
  import { swatchStore, filterSwatches, type Swatch, type SwatchGroup } from "./Swatches.store.svelte";
  import { rgbToHex } from "./color-model";

  $effect(() => {
    if (settings.loaded) swatchStore.hydrate();
  });

  const q = $derived(swatchStore.query);
  const items = $derived(filterSwatches(swatchStore.items, q));
  const groups = $derived(swatchStore.groups.map((g) => ({ g, list: filterSwatches(g.swatches, q) })).filter((x) => !q || x.list.length > 0));
  const fgHex = $derived(rgbToHex(toolStore.fg));

  type NameProps = { title: string; label: string; initial: string; okLabel: string };
  const askName = (title: string, initial: string): Promise<string | null> => openDialog<NameProps, string>(HistorySnapshotDialog, { title, label: "Name:", initial, okLabel: "OK" });

  function pick(e: MouseEvent, s: Swatch): void {
    if (e.altKey) {
      swatchStore.remove(s.id);
      return;
    }
    const c = { r: s.color.r, g: s.color.g, b: s.color.b, a: 255 };
    if (e.ctrlKey || e.metaKey) toolStore.setBg(c);
    else toolStore.setFg(c);
  }
  function tip(s: Swatch): string {
    return `${s.name}  ${rgbToHex(s.color).toUpperCase()}`;
  }
  async function addFg(groupId: string | null = null): Promise<void> {
    const name = await askName("Color Swatch Name", `Swatch ${swatchStore.all.length + 1}`);
    if (name !== null) swatchStore.add({ ...toolStore.fg }, name, groupId);
  }
  async function newGroup(): Promise<void> {
    const name = await askName("Group Name", `Group ${swatchStore.groups.length + 1}`);
    if (name !== null) swatchStore.addGroup(name);
  }
  function deleteCurrent(): void {
    const hit = swatchStore.all.find((s) => rgbToHex(s.color) === fgHex);
    if (hit) swatchStore.remove(hit.id);
    else toast.info("No swatch matches the foreground colour.");
  }
  function menuFor(e: MouseEvent, s: Swatch): void {
    e.preventDefault();
    contextMenu.open(e.clientX, e.clientY, [
      { label: "Rename Swatch…", run: async () => { const n = await askName("Swatch Name", s.name); if (n !== null) swatchStore.rename(s.id, n); } },
      { label: "Delete Swatch", run: () => { swatchStore.remove(s.id); } },
      { separator: true },
      { label: "Copy Color's Hex Code", run: () => void navigator.clipboard?.writeText(rgbToHex(s.color).toUpperCase()) },
    ]);
  }
  function groupMenu(e: MouseEvent, g: SwatchGroup): void {
    e.preventDefault();
    contextMenu.open(e.clientX, e.clientY, [
      { label: "New Swatch in Group", run: () => void addFg(g.id) },
      { label: "Rename Group…", run: async () => { const n = await askName("Group Name", g.name); if (n !== null) { g.name = n; swatchStore.persist(); } } },
      { label: "Delete Group", danger: true, run: () => swatchStore.removeGroup(g.id) },
    ]);
  }
</script>

<div class="swatches" class:large={swatchStore.thumb === "large"}>
  <div class="search">
    <Icon name="search" size={12} />
    <input class="input q" type="text" placeholder="Search Swatches" bind:value={swatchStore.query} spellcheck="false" aria-label="Search swatches" onkeydown={(e) => e.stopPropagation()} />
  </div>

  <div class="list">
    <div class="grid" aria-label="Default swatches">
      {#each items as s (s.id)}
        <button type="button" class="sw" class:on={rgbToHex(s.color) === fgHex} style:background={rgbToHex(s.color)} title={tip(s)} aria-label={s.name} onclick={(e) => pick(e, s)} oncontextmenu={(e) => menuFor(e, s)}></button>
      {/each}
    </div>
    {#each groups as { g, list } (g.id)}
      <div class="group">
        <button type="button" class="ghead" onclick={() => swatchStore.toggleGroup(g.id)} oncontextmenu={(e) => groupMenu(e, g)} aria-expanded={!g.collapsed || !!q}>
          <Icon name={g.collapsed && !q ? "chevron-right" : "chevron-down"} size={10} />
          <Icon name="folder" size={14} />
          <span class="gname">{g.name}</span>
          <span class="gcount">{g.swatches.length}</span>
        </button>
        {#if !g.collapsed || q}
          <div class="grid indent" aria-label={g.name}>
            {#each list as s (s.id)}
              <button type="button" class="sw" class:on={rgbToHex(s.color) === fgHex} style:background={rgbToHex(s.color)} title={tip(s)} aria-label={s.name} onclick={(e) => pick(e, s)} oncontextmenu={(e) => menuFor(e, s)}></button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if items.length === 0 && groups.length === 0}
      <div class="empty">No swatches match "{q}".</div>
    {/if}
  </div>

  <div class="bar">
    <span class="grow"></span>
    <button type="button" class="icon-btn" data-tip="Create new group" aria-label="New group" onclick={() => void newGroup()}><Icon name="folder" size={16} /></button>
    <button type="button" class="icon-btn" data-tip="Create new swatch of foreground color" aria-label="New swatch" onclick={() => void addFg()}><Icon name="new-layer" size={16} /></button>
    <button type="button" class="icon-btn" data-tip="Delete swatch" aria-label="Delete swatch" onclick={deleteCurrent}><Icon name="trash" size={16} /></button>
  </div>
</div>

<style>
  .swatches {
    --cell: 14px;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .swatches.large {
    --cell: 22px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    color: var(--ps-text-dim);
    border-bottom: 1px solid var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
  }
  .q {
    flex: 1;
    min-width: 0;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 6px 4px;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    padding-bottom: 4px;
  }
  .grid.indent {
    padding: 2px 0 6px 14px;
  }
  .sw {
    width: var(--cell);
    height: var(--cell);
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
  }
  .sw:hover {
    outline: 1px solid var(--ps-text);
    outline-offset: 0;
    z-index: 1;
  }
  .sw.on {
    outline: 1px solid var(--ps-text);
    outline-offset: 1px;
  }
  .group {
    margin-top: 2px;
  }
  .ghead {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: var(--row-h);
    padding: 0 2px;
    color: var(--ps-text);
    text-align: left;
  }
  .ghead:hover {
    background: var(--ps-hover);
  }
  .gname {
    flex: 1;
  }
  .gcount {
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
  }
  .empty {
    padding: 8px 2px;
    color: var(--ps-text-dim);
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    padding: 0 4px;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .grow {
    flex: 1;
  }
</style>
