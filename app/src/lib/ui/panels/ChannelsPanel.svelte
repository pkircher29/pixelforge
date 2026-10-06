<script lang="ts">
  /**
   * Channels panel — RGB / Red / Green / Blue / alpha channels / the active layer's
   * mask. Click → view the channel; eye → PS composite rules (see Channels.model);
   * Ctrl-click → load as selection (Shift add, Alt subtract); double-click an alpha →
   * Channel Options. Bottom bar: load selection, save selection, new channel, delete.
   */
  import { untrack } from "svelte";
  import { channelViewRaster, compositeToRaster, type Layer, type SelectionCombineMode } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import Icon from "../icons/Icon.svelte";
  import { contextMenu } from "../context-menu.svelte";
  import { layersUi } from "./Layers.store.svelte";
  import { buildChannelRows, clickChannel, toggleChannelEye, type ChannelRow } from "./Channels.model";
  import { drawChannelThumb, drawLayerThumb, thumbDims } from "./thumbnail";
  import { applyChannelView, loadChannelSelection, channelOptions, saveSelectionAsChannel, newChannel, deleteChannel, duplicateChannel } from "./Channels.commands";

  const entry = $derived(docStore.active);
  const doc = $derived(entry?.doc ?? null);

  $effect(() => {
    const id = entry?.id ?? null;
    untrack(() => {
      layersUi.bind(id);
      ui.viewChannel = "rgb";
    });
  });

  const rows = $derived.by((): ChannelRow[] => {
    if (!entry || !doc) return [];
    void entry.version;
    return buildChannelRows(doc, docStore.activeLayer, ui.viewChannel, layersUi.hiddenChannels);
  });
  const dims = $derived(thumbDims("medium", doc?.width ?? 1, doc?.height ?? 1));
  const selectedAlpha = $derived.by(() => {
    if (!doc) return null;
    void entry?.version;
    const v = ui.viewChannel;
    return v.startsWith("alpha:") ? (doc.alphaChannels.find((c) => c.id === v.slice(6)) ?? null) : null;
  });
  const hasSel = $derived.by(() => {
    if (!entry) return false;
    void entry.version;
    return !entry.doc.selection.isEmpty;
  });

  function mode(e: MouseEvent): SelectionCombineMode {
    if (e.shiftKey && e.altKey) return "intersect";
    if (e.shiftKey) return "add";
    if (e.altKey) return "subtract";
    return "replace";
  }

  function onRowClick(e: MouseEvent, row: ChannelRow) {
    if (e.ctrlKey || e.metaKey) {
      loadChannelSelection(row, mode(e));
      return;
    }
    applyChannelView(clickChannel(row, rows));
  }

  function onEye(e: MouseEvent, row: ChannelRow) {
    e.stopPropagation();
    applyChannelView(toggleChannelEye(rows, row, ui.viewChannel, layersUi.hiddenChannels));
  }

  function onContext(e: MouseEvent, row: ChannelRow) {
    e.preventDefault();
    const ch = row.kind === "alpha" && doc ? doc.alphaChannels.find((c) => c.id === row.id) : null;
    contextMenu.open(e.clientX, e.clientY, [
      { label: "Duplicate Channel…", disabled: !ch, run: () => { applyChannelView(clickChannel(row, rows)); duplicateChannel(); } },
      { label: "Delete Channel", disabled: !ch, run: () => { applyChannelView(clickChannel(row, rows)); deleteChannel(); } },
      { separator: true },
      { label: "Channel Options…", disabled: !ch, run: () => ch && void channelOptions(ch) },
    ]);
  }

  /** Thumbnail painter per row kind (debounced; re-run when the row or pixel version changes). */
  function thumb(el: HTMLCanvasElement, args: { row: ChannelRow; tick: number }) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const paint = () => {
      const d = doc;
      if (!d) return;
      const comp = compositeToRaster(d);
      if (args.row.kind === "composite") {
        const l = { kind: "raster", raster: comp, offset: { x: 0, y: 0 } } as unknown as Layer;
        drawLayerThumb(el, l, d.width, d.height, dims.w, dims.h);
      } else {
        const r = channelViewRaster(d, comp, args.row.view, d.activeLayerId);
        if (r) drawChannelThumb(el, r, dims.w, dims.h);
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(paint, 150);
    };
    schedule();
    return {
      update(a: { row: ChannelRow; tick: number }) {
        args = a;
        schedule();
      },
      destroy() {
        if (timer) clearTimeout(timer);
      },
    };
  }
</script>

<div class="channels">
  {#if entry && doc}
    <div class="list" role="listbox" aria-label="Channels">
      {#each rows as row (row.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <div class="row" class:selected={row.selected} class:hidden={!row.visible} role="option" aria-selected={row.selected} tabindex="0" onclick={(e) => onRowClick(e, row)} oncontextmenu={(e) => onContext(e, row)} ondblclick={() => { const ch = doc.alphaChannels.find((c) => c.id === row.id); if (ch) void channelOptions(ch); }}>
          <span class="eyecell"><button type="button" class="eye" class:off={!row.visible} aria-label={row.visible ? "Hide channel" : "Show channel"} onclick={(e) => onEye(e, row)}><Icon name={row.visible ? "eye" : "eye-off"} size={14} /></button></span>
          <span class="thumb" style:width="{dims.w}px" style:height="{dims.h}px"><canvas use:thumb={{ row, tick: entry.pixelVersion }}></canvas></span>
          <span class="name">{row.name}</span>
          {#if row.shortcut}<span class="sc">{row.shortcut}</span>{/if}
        </div>
      {/each}
    </div>
    <div class="footer">
      <button type="button" class="fb" data-tip="Load channel as selection" aria-label="Load channel as selection" disabled={!rows.find((r) => r.selected)} onclick={() => { const r = rows.find((x) => x.selected); if (r) loadChannelSelection(r, "replace"); }}><Icon name="marquee-rect" size={16} /></button>
      <button type="button" class="fb" data-tip="Save selection as channel" aria-label="Save selection as channel" disabled={!hasSel} onclick={saveSelectionAsChannel}><Icon name="mask" size={16} /></button>
      <button type="button" class="fb" data-tip="Create new channel" aria-label="Create new channel" onclick={newChannel}><Icon name="new-layer" size={16} /></button>
      <button type="button" class="fb" data-tip="Delete current channel" aria-label="Delete current channel" disabled={!selectedAlpha} onclick={deleteChannel}><Icon name="trash" size={16} /></button>
    </div>
  {:else}
    <div class="empty">Open a document to see its channels.</div>
  {/if}
</div>

<style>
  .channels {
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
    gap: 6px;
    height: 40px;
    padding-right: 8px;
    border-bottom: 1px solid var(--ps-border-dark);
    outline: none;
  }
  .row:hover {
    background: var(--ps-hover);
  }
  .row.selected {
    background: var(--ps-row-selected);
  }
  .row.hidden .name {
    color: var(--ps-text-dim);
  }
  .eyecell {
    align-self: stretch;
    display: grid;
    place-items: center;
    width: 22px;
    border-right: 1px solid var(--ps-border-dark);
  }
  .eye {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    color: var(--ps-text);
  }
  .eye.off {
    color: transparent;
  }
  .row:hover .eye.off {
    color: var(--ps-text-disabled);
  }
  .thumb {
    display: inline-grid;
    flex: none;
    box-sizing: content-box;
    border: 1px solid #0a0a0a;
    outline: 1px solid #c8c8c8;
    outline-offset: -2px;
    background: #808080;
    image-rendering: pixelated;
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
  .sc {
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
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
