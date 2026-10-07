<script lang="ts">
  /**
   * History panel (PS): snapshot rows (thumbnail · name) above a separator, then the
   * history states with the History Brush source column on the left; the current
   * state is highlighted, later states are greyed (click to redo-jump). Bottom bar:
   * new document from state · camera · trash. Double-click a snapshot to rename it.
   */
  import { untrack } from "svelte";
  import { docStore } from "$lib/stores/doc.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { contextMenu } from "../context-menu.svelte";
  import { openDialog } from "../dialogs/dialogs.svelte";
  import { runCommand } from "../registry.svelte";
  import Icon from "../icons/Icon.svelte";
  import HistorySnapshotDialog from "./HistorySnapshotDialog.svelte";
  import { historyUi, SNAP_THUMB } from "./History.store.svelte";
  import { cameraClick, deleteSelected, newDocumentFromState } from "./History.commands";
  import { buildHistoryRows, type SnapshotRow, type StateRow } from "./History.model";

  const entry = $derived(docStore.active);
  $effect(() => {
    if (settings.loaded) historyUi.hydrate();
  });
  // Automatically create the first snapshot (History Options) when a document first shows up.
  $effect(() => {
    const e = entry;
    void settings.loaded;
    if (e) untrack(() => historyUi.ensureFirstSnapshot(e));
  });

  const rows = $derived.by(() => {
    const e = entry;
    if (!e) return null;
    void e.version;
    const h = e.history;
    return buildHistoryRows({
      entries: h.entries,
      index: h.index,
      snapshots: h.snapshots,
      source: toolStore.historySource,
      opened: e.path !== null,
      evicted: h.evictedCount,
    });
  });
  const selected = $derived(historyUi.selected);

  let list = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const el = list;
    const idx = rows?.states.findIndex((s) => s.current);
    if (!el || idx === undefined) return;
    queueMicrotask(() => el.querySelector<HTMLElement>(".state.current")?.scrollIntoView({ block: "nearest" }));
  });

  function clickState(row: StateRow): void {
    const e = entry;
    if (!e) return;
    historyUi.selected = { kind: "state", index: row.index };
    historyUi.jumpTo(e, row.index);
  }
  function clickSnapshot(row: SnapshotRow): void {
    const e = entry;
    if (!e) return;
    historyUi.selected = { kind: "snapshot", id: row.id };
    historyUi.restoreSnapshot(e, row.id);
  }
  async function renameSnapshot(row: SnapshotRow): Promise<void> {
    const e = entry;
    if (!e) return;
    const name = await openDialog<{ title: string; label: string; initial: string; okLabel: string }, string>(HistorySnapshotDialog, { title: "Rename Snapshot", label: "Name:", initial: row.name, okLabel: "OK" });
    if (name !== null) historyUi.renameSnapshot(e, row.id, name);
  }
  function snapshotMenu(ev: MouseEvent, row: SnapshotRow): void {
    ev.preventDefault();
    const e = entry;
    if (!e) return;
    historyUi.selected = { kind: "snapshot", id: row.id };
    contextMenu.open(ev.clientX, ev.clientY, [
      { label: "Set as History Brush Source", checked: row.isSource, run: () => historyUi.setSource({ kind: "snapshot", id: row.id }) },
      { label: "Rename…", run: () => void renameSnapshot(row) },
      { separator: true },
      { label: "Delete Snapshot", danger: true, run: () => historyUi.deleteSnapshot(e, row.id) },
    ]);
  }
  function stateMenu(ev: MouseEvent, row: StateRow): void {
    ev.preventDefault();
    const e = entry;
    if (!e) return;
    historyUi.selected = { kind: "state", index: row.index };
    contextMenu.open(ev.clientX, ev.clientY, [
      { label: "Set as History Brush Source", checked: row.isSource, run: () => historyUi.setSource({ kind: "state", index: row.index }) },
      { label: "New Snapshot…", run: () => void runCommand("history.takeSnapshot") },
      { label: "New Document", run: () => { newDocumentFromState(e); } },
      { separator: true },
      { label: "Delete", disabled: row.index === 0, run: () => deleteSelected(e) },
      { label: "Clear History", run: () => void runCommand("history.clear") },
    ]);
  }
  const canDelete = $derived(!!entry && selected !== null && !(selected.kind === "state" && selected.index === 0));
</script>

<div class="history">
  {#if entry && rows}
    <div class="list" bind:this={list}>
      {#each rows.snapshots as s (s.id)}
        <div class="snap" class:selected={selected?.kind === "snapshot" && selected.id === s.id} role="row">
          <button type="button" class="src" class:on={s.isSource} data-tip="Sets the source for the history brush" aria-label="History brush source" aria-pressed={s.isSource} onclick={() => historyUi.setSource({ kind: "snapshot", id: s.id })}>
            {#if s.isSource}<Icon name="history-source" size={13} />{/if}
          </button>
          <button type="button" class="snaprow" onclick={() => clickSnapshot(s)} ondblclick={() => void renameSnapshot(s)} oncontextmenu={(e) => snapshotMenu(e, s)} title={s.name}>
            <span class="thumb" style:width="{SNAP_THUMB.w}px" style:height="{SNAP_THUMB.h}px">
              {#if historyUi.thumbs[s.id]}<img src={historyUi.thumbs[s.id]} alt="" />{/if}
            </span>
            <span class="name">{s.name}</span>
          </button>
        </div>
      {/each}
      {#if rows.snapshots.length}<div class="sep"></div>{/if}
      {#each rows.states as st (st.key)}
        <div class="state" class:current={st.current} class:undone={st.undone} class:selected={selected?.kind === "state" && selected.index === st.index} role="row">
          <button type="button" class="src" class:on={st.isSource} data-tip="Sets the source for the history brush" aria-label="History brush source" aria-pressed={st.isSource} onclick={() => historyUi.setSource({ kind: "state", index: st.index })}>
            {#if st.isSource}<Icon name="history-source" size={13} />{/if}
          </button>
          <button type="button" class="staterow" onclick={() => clickState(st)} oncontextmenu={(e) => stateMenu(e, st)} title={st.label}>
            <span class="ico"><Icon name={st.icon} size={14} /></span>
            <span class="name">{st.label}</span>
          </button>
        </div>
      {/each}
    </div>
    <div class="bar">
      <span class="grow"></span>
      <button type="button" class="icon-btn" data-tip="Create new document from current state" aria-label="New document from current state" onclick={() => newDocumentFromState(entry)}><Icon name="document-new" size={16} /></button>
      <button type="button" class="icon-btn" data-tip="Create new snapshot" aria-label="Create new snapshot" onclick={(e) => cameraClick(entry, e.altKey)}><Icon name="snapshot" size={16} /></button>
      <button type="button" class="icon-btn" data-tip="Delete current state" aria-label="Delete" disabled={!canDelete} onclick={() => deleteSelected(entry)}><Icon name="trash" size={16} /></button>
    </div>
  {:else}
    <div class="empty">Open a document to see its history.</div>
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
    padding: 2px 0;
  }
  .snap,
  .state {
    display: flex;
    align-items: stretch;
    color: var(--ps-text);
  }
  .snap {
    height: 34px;
  }
  .state {
    height: var(--row-h);
  }
  .snap:hover,
  .state:hover {
    background: var(--ps-hover);
  }
  .state.current,
  .snap.selected {
    background: var(--ps-row-selected);
  }
  .state.selected:not(.current) {
    box-shadow: inset 0 0 0 1px var(--ps-border-light);
  }
  .state.undone {
    color: var(--ps-text-disabled);
  }
  .state.undone .ico {
    opacity: 0.45;
  }
  .src {
    display: grid;
    place-items: center;
    width: 18px;
    flex: none;
    color: var(--ps-text);
    border-right: 1px solid var(--ps-border-dark);
  }
  .src:hover {
    background: var(--ps-active);
  }
  .snaprow,
  .staterow {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 0 6px 0 4px;
    text-align: left;
    color: inherit;
  }
  .thumb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    background: #cbcbcb;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
    overflow: hidden;
  }
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }
  .ico {
    display: inline-grid;
    place-items: center;
    width: 16px;
    flex: none;
    color: var(--ps-text-dim);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    margin: 2px 0;
    background: var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
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
  .empty {
    padding: 10px;
    color: var(--ps-text-dim);
  }
</style>
