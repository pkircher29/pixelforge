<script lang="ts">
  import { docStore } from "$lib/stores/doc.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { documentByteSize, formatZoom, clampZoom } from "$lib/engine";
  import { canvasHost } from "./canvas/host.svelte";

  let editingZoom = $state(false);
  let zoomText = $state("");
  let zoomInput = $state<HTMLInputElement | null>(null);

  const entry = $derived(docStore.active);
  // Engine objects are raw: snapshot the scalars we display whenever `version` ticks.
  const view = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    return { w: entry.doc.width, h: entry.doc.height, zoom: entry.viewport.zoom };
  });
  const zoom = $derived(view?.zoom ?? null);
  const memory = $derived.by(() => {
    if (!entry) return "";
    void entry.pixelVersion;
    const bytes = documentByteSize(entry.doc) + entry.history.bytes;
    return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`;
  });

  function startZoomEdit() {
    if (zoom === null) return;
    zoomText = String(Math.round(zoom * 100));
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
    <span class="mono">{view.w} × {view.h} px</span>
    <span class="sep"></span>
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
      <button type="button" class="zoom mono" onclick={startZoomEdit} data-tip="Click to type a zoom level">{zoom === null ? "--" : formatZoom(zoom)}</button>
    {/if}
    <span class="sep"></span>
    <span class="mono coords">{ui.cursorDoc ? `${ui.cursorDoc.x}, ${ui.cursorDoc.y}` : "–, –"}</span>
    <span class="sep"></span>
    <span class="hint">{toolStore.hint}</span>
    <span class="grow"></span>
    <span class="mono muted">{memory}</span>
    <span class="sep"></span>
    {#if canvasHost.compositorKind}
      <span class="badge" class:gl={canvasHost.compositorKind === "webgl2"} class:cpu={canvasHost.compositorKind !== "webgl2"} data-tip={canvasHost.compositorKind === "webgl2" ? "WebGL2 compositor" : "Canvas 2D fallback compositor"}>
        {canvasHost.compositorKind === "webgl2" ? "GL" : "2D"}
      </span>
    {/if}
  {:else}
    <span class="muted">No document open</span>
    <span class="grow"></span>
    <span class="muted">Ctrl+N new · Ctrl+O open · Ctrl+K commands</span>
  {/if}
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--statusbar-h);
    padding: 0 10px;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .coords {
    min-width: 76px;
  }
  .sep {
    width: 1px;
    height: 12px;
    background: var(--border-strong);
  }
  .grow {
    flex: 1;
  }
  .muted {
    color: var(--fg-2);
  }
  .hint {
    color: var(--fg-2);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .zoom {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    min-width: 52px;
    text-align: center;
    color: var(--fg-0);
  }
  .zoom:hover {
    background: var(--bg-3);
  }
  .zoom-in {
    width: 52px;
    padding: 0 4px;
    font: inherit;
    font-family: var(--font-mono);
    background: var(--bg-0);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--fg-0);
    outline: none;
  }
  .badge {
    padding: 1px 7px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }
  .badge.gl {
    color: var(--accent-2);
    background: rgba(34, 211, 238, 0.12);
  }
  .badge.cpu {
    color: #f6c177;
    background: rgba(246, 193, 119, 0.14);
  }
</style>
