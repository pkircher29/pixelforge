<script lang="ts">
  /** PS status bar: `66.7% ▸ │ Doc: 5.93M/5.93M ▸ │ hint … GL`. Zoom is editable; ▸ picks the info field. */
  import { docStore } from "$lib/stores/doc.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { ui, type StatusInfoKind } from "$lib/stores/ui.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { documentByteSize, formatZoom, clampZoom } from "$lib/engine";
  import { toolLabel } from "$lib/tools";
  import { canvasHost } from "./canvas/host.svelte";
  import Icon from "./icons/Icon.svelte";
  import Popover from "./controls/Popover.svelte";
  import { statusInfoText } from "./status-info";

  let editingZoom = $state(false);
  let zoomText = $state("");
  let zoomInput = $state<HTMLInputElement | null>(null);
  let infoBtn = $state<HTMLButtonElement | null>(null);
  let infoOpen = $state(false);

  const entry = $derived(docStore.active);
  const view = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    return { w: entry.doc.width, h: entry.doc.height, zoom: entry.viewport.zoom, dpi: entry.doc.meta.dpi, layers: entry.doc.layers.length };
  });
  const zoom = $derived(view?.zoom ?? null);
  const sizes = $derived.by(() => {
    if (!entry) return null;
    void entry.pixelVersion;
    return { flat: entry.doc.width * entry.doc.height * 4, layers: documentByteSize(entry.doc), history: entry.history.bytes };
  });
  const info = $derived.by(() => {
    if (!view || !sizes) return "";
    return statusInfoText(ui.statusInfo, {
      w: view.w,
      h: view.h,
      dpi: view.dpi,
      layerCount: view.layers,
      flat: sizes.flat,
      layerBytes: sizes.layers,
      historyBytes: sizes.history,
      budgetBytes: settings.value.historyBudgetMb * 1048576,
      renderMs: ui.lastRenderMs,
      toolName: toolLabel(canvasHost.selectedTool),
    });
  });

  const INFO_KINDS: { id: StatusInfoKind; label: string }[] = [
    { id: "sizes", label: "Document Sizes" },
    { id: "profile", label: "Document Profile" },
    { id: "dimensions", label: "Document Dimensions" },
    { id: "scratch", label: "Scratch Sizes" },
    { id: "efficiency", label: "Efficiency" },
    { id: "timing", label: "Timing" },
    { id: "tool", label: "Current Tool" },
  ];

  function startZoomEdit() {
    if (zoom === null) return;
    zoomText = formatZoom(zoom).replace("%", "");
    editingZoom = true;
    queueMicrotask(() => zoomInput?.select());
  }
  function commitZoom() {
    editingZoom = false;
    const v = parseFloat(zoomText);
    if (!entry || !Number.isFinite(v) || v <= 0) return;
    entry.viewport.setZoomAt({ x: canvasHost.viewW / 2, y: canvasHost.viewH / 2 }, clampZoom(v / 100));
    docStore.touch();
  }
</script>

<footer class="statusbar">
  {#if entry && view}
    <span class="cell zoomcell">
      {#if editingZoom}
        <input
          bind:this={zoomInput}
          bind:value={zoomText}
          class="zoom-in"
          type="text"
          inputmode="decimal"
          onkeydown={(e) => {
            if (e.key === "Enter") commitZoom();
            else if (e.key === "Escape") editingZoom = false;
            e.stopPropagation();
          }}
          onblur={commitZoom}
          aria-label="Zoom percent"
        />
      {:else}
        <button type="button" class="zoom" onclick={startZoomEdit} data-tip="Zoom level — click to type">{zoom === null ? "--" : formatZoom(zoom)}</button>
      {/if}
      <span class="tri"><Icon name="chevron-right" size={8} /></span>
    </span>
    <span class="vsep"></span>
    <span class="cell">
      <span class="info" title={info}>{info}</span>
      <button type="button" class="tri btn-tri" bind:this={infoBtn} aria-label="Status bar options" onclick={() => (infoOpen = !infoOpen)}><Icon name="chevron-right" size={8} /></button>
    </span>
    <Popover anchor={infoBtn} open={infoOpen} onclose={() => (infoOpen = false)} up minWidth={180}>
      <div class="imenu" role="menu">
        {#each INFO_KINDS as k (k.id)}
          <button type="button" role="menuitemradio" aria-checked={ui.statusInfo === k.id} class="iitem" onclick={() => { ui.setStatusInfo(k.id); infoOpen = false; }}>
            <span class="ichk">{#if ui.statusInfo === k.id}<Icon name="check" size={12} />{/if}</span>{k.label}
          </button>
        {/each}
      </div>
    </Popover>
    <span class="vsep"></span>
    <span class="hint">{toolStore.hint}</span>
    <span class="grow"></span>
    <span class="coords">{ui.cursorDoc ? `${ui.cursorDoc.x}, ${ui.cursorDoc.y}` : ""}</span>
    {#if canvasHost.compositorKind}
      <span class="vsep"></span>
      <span class="badge" data-tip={canvasHost.compositorKind === "webgl2" ? "WebGL2 compositor" : "Canvas 2D fallback compositor"}>{canvasHost.compositorKind === "webgl2" ? "GL" : "2D"}</span>
    {/if}
  {:else}
    <span class="hint">No document open</span>
    <span class="grow"></span>
    <span class="hint">Ctrl+N new · Ctrl+O open · Ctrl+K commands</span>
  {/if}
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: 0;
    height: var(--statusbar-h);
    padding: 0 6px 0 4px;
    background: var(--ps-app);
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
    font-size: var(--fs-sm);
    color: var(--ps-text);
    white-space: nowrap;
    overflow: hidden;
  }
  .cell {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    font-variant-numeric: tabular-nums;
  }
  .vsep {
    width: 1px;
    height: 100%;
    background: var(--ps-border-dark);
    box-shadow: 1px 0 0 var(--ps-border-light);
    margin: 0 2px;
  }
  .tri {
    display: grid;
    place-items: center;
    color: var(--ps-text-dim);
  }
  .btn-tri {
    width: 14px;
    height: 16px;
    border-radius: 2px;
  }
  .btn-tri:hover {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .zoom {
    min-width: 46px;
    padding: 0 2px;
    text-align: left;
    color: var(--ps-text);
    font-variant-numeric: tabular-nums;
  }
  .zoom:hover {
    background: var(--ps-hover);
  }
  .zoom-in {
    width: 46px;
    height: 16px;
    padding: 0 2px;
    font: inherit;
    background: var(--ps-input);
    border: 1px solid var(--ps-accent);
    color: var(--ps-text);
    outline: none;
  }
  .info {
    min-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    color: var(--ps-text-dim);
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grow {
    flex: 1;
  }
  .coords {
    color: var(--ps-text-dim);
    font-variant-numeric: tabular-nums;
    min-width: 70px;
    text-align: right;
    padding-right: 6px;
  }
  .badge {
    padding: 0 5px;
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
    letter-spacing: 0.04em;
  }
  .imenu {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .iitem {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 12px 0 4px;
    text-align: left;
    color: var(--ps-text);
  }
  .iitem:hover {
    background: var(--ps-row-selected);
  }
  .ichk {
    display: grid;
    width: 16px;
    place-items: center;
  }
</style>
