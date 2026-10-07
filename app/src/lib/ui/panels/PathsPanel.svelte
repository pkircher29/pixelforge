<script lang="ts">
  /**
   * Paths panel — saved paths and the Work Path (italic, listed last like PS).
   * Click to activate; double-click to rename (Save Path… for the work path).
   * Bottom bar: fill with foreground, stroke with brush, load as selection, make
   * work path from selection, new path, delete.
   */
  import { untrack } from "svelte";
  import { docStore } from "$lib/stores/doc.svelte";
  import Icon from "../icons/Icon.svelte";
  import { contextMenu } from "../context-menu.svelte";
  import { getCommand } from "../registry.svelte";
  import { layersUi } from "./Layers.store.svelte";
  import { buildPathRows, savePathCommand, renamePathCommand, type PathRow } from "./Paths.model";
  import { drawPathThumb, thumbDims } from "./thumbnail";
  import { fillPath, strokePath, loadPathSelection, makeSelectionDialog, makeWorkPath, newPath, deletePath, duplicatePath } from "./Paths.commands";

  const entry = $derived(docStore.active);
  const doc = $derived(entry?.doc ?? null);

  $effect(() => {
    const id = entry?.id ?? null;
    untrack(() => layersUi.bind(id));
  });

  const rows = $derived.by((): PathRow[] => {
    if (!entry || !doc) return [];
    void entry.version;
    const active = layersUi.activePathId ?? doc.workPathId;
    return buildPathRows(doc, active);
  });
  const activeRow = $derived(rows.find((r) => r.active) ?? null);
  const dims = $derived(thumbDims("medium", doc?.width ?? 1, doc?.height ?? 1));
  const hasSel = $derived.by(() => {
    if (!entry) return false;
    void entry.version;
    return !entry.doc.selection.isEmpty;
  });
  const pixelTarget = $derived.by(() => {
    void entry?.version;
    const l = docStore.activeLayer;
    return l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text") ? l : null;
  });

  let renaming = $state<string | null>(null);
  let renameText = $state("");

  function activate(r: PathRow) {
    layersUi.activePathId = r.id;
  }
  function startRename(r: PathRow) {
    renaming = r.id;
    renameText = r.isWork ? "Path 1" : r.name;
  }
  function commitRename(r: PathRow) {
    if (renaming !== r.id || !doc) return;
    renaming = null;
    const name = renameText.trim();
    if (!name) return;
    const cmd = r.isWork ? savePathCommand(doc, name) : renamePathCommand(doc, r.id, name);
    if (cmd) docStore.exec(cmd);
  }

  function onContext(e: MouseEvent, r: PathRow) {
    e.preventDefault();
    activate(r);
    contextMenu.open(e.clientX, e.clientY, [
      { label: r.isWork ? "Save Path…" : "Rename Path…", run: () => startRename(r) },
      { label: "Duplicate Path…", run: duplicatePath },
      { label: "Delete Path", run: deletePath },
      { separator: true },
      { label: "Make Selection…", run: () => void makeSelectionDialog() },
      { label: "Fill Path…", disabled: !pixelTarget, run: () => void getCommand("path.fillDialog")?.run() },
      { label: "Stroke Path…", disabled: !pixelTarget, run: () => void getCommand("path.strokeWithTool")?.run() },
      { separator: true },
      { label: "Clipping Path…", disabled: true },
    ]);
  }

  function thumb(el: HTMLCanvasElement, args: { row: PathRow; tick: number }) {
    const paint = () => {
      if (doc) drawPathThumb(el, args.row.path, doc.width, doc.height, dims.w, dims.h);
    };
    paint();
    return {
      update(a: { row: PathRow; tick: number }) {
        args = a;
        paint();
      },
    };
  }
</script>

<div class="paths">
  {#if entry && doc}
    <div class="list" role="listbox" aria-label="Paths">
      {#each rows as r (r.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <div class="row" class:selected={r.active} role="option" aria-selected={r.active} tabindex="0" onclick={() => activate(r)} oncontextmenu={(e) => onContext(e, r)} ondblclick={() => startRename(r)}>
          <span class="thumb" style:width="{dims.w}px" style:height="{dims.h}px"><canvas use:thumb={{ row: r, tick: entry.version }}></canvas></span>
          {#if renaming === r.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="rename" type="text" bind:value={renameText} autofocus onblur={() => commitRename(r)} onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRename(r); if (e.key === "Escape") renaming = null; }} onclick={(e) => e.stopPropagation()} />
          {:else}
            <span class="name" class:work={r.isWork}>{r.name}</span>
          {/if}
        </div>
      {/each}
      {#if rows.length === 0}
        <div class="empty">No paths yet. Draw one with the Pen tool or make a work path from a selection.</div>
      {/if}
    </div>
    <div class="footer">
      <button type="button" class="fb" data-tip="Fill path with foreground color" aria-label="Fill path with foreground color" disabled={!activeRow || !pixelTarget} onclick={fillPath}><Icon name="bucket" size={16} /></button>
      <button type="button" class="fb" data-tip="Stroke path with brush" aria-label="Stroke path with brush" disabled={!activeRow || !pixelTarget} onclick={strokePath}><Icon name="brush" size={16} /></button>
      <button type="button" class="fb" data-tip="Load path as a selection" aria-label="Load path as a selection" disabled={!activeRow} onclick={loadPathSelection}><Icon name="marquee-rect" size={16} /></button>
      <button type="button" class="fb" data-tip="Make work path from selection" aria-label="Make work path from selection" disabled={!hasSel} onclick={makeWorkPath}><Icon name="pen" size={16} /></button>
      <button type="button" class="fb" data-tip="Add a mask (disabled)" aria-label="Add a mask" disabled><Icon name="mask" size={16} /></button>
      <button type="button" class="fb" data-tip="Create new path" aria-label="Create new path" onclick={newPath}><Icon name="new-layer" size={16} /></button>
      <button type="button" class="fb" data-tip="Delete current path" aria-label="Delete current path" disabled={!activeRow} onclick={deletePath}><Icon name="trash" size={16} /></button>
    </div>
  {:else}
    <div class="empty">Open a document to see its paths.</div>
  {/if}
</div>

<style>
  .paths {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-size: var(--fs-sm);
    color: var(--ps-text);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 8px 0 6px;
    border-bottom: 1px solid var(--ps-border-dark);
    outline: none;
  }
  .row:hover {
    background: var(--ps-hover);
  }
  .row.selected {
    background: var(--ps-row-selected);
  }
  .thumb {
    display: inline-grid;
    flex: none;
    box-sizing: content-box;
    border: 1px solid #0a0a0a;
    outline: 1px solid #c8c8c8;
    outline-offset: -2px;
    background: #fff;
  }
  .thumb canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name.work {
    font-style: italic;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 18px;
    padding: 0 3px;
    font: inherit;
    background: var(--ps-input);
    border: 1px solid var(--ps-accent);
    border-radius: 2px;
    color: var(--ps-text);
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }
  .footer {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    height: 24px;
    padding: 0 4px;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .fb {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 20px;
    border-radius: 2px;
    color: var(--ps-text);
  }
  .fb:hover:not(:disabled) {
    background: var(--ps-hover);
  }
  .fb:disabled {
    opacity: 0.35;
  }
  .empty {
    padding: 14px 10px;
    color: var(--ps-text-dim);
  }
</style>
