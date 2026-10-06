<script lang="ts">
  import TitleBar from "./lib/ui/TitleBar.svelte";
  import Toolbar from "./lib/ui/Toolbar.svelte";
  import CanvasView from "./lib/ui/CanvasView.svelte";
  import RightPanel from "./lib/ui/RightPanel.svelte";
  import type { CanvasInfo } from "./lib/ui/CanvasView.svelte";

  // Placeholder document until the engine wave lands.
  const doc = $state({ name: "Untitled-1", width: 1920, height: 1080 });

  let canvasInfo = $state<CanvasInfo | null>(null);
  let activeTool = $state("move");

  const zoomLabel = $derived(
    canvasInfo ? `${Math.round(canvasInfo.zoom * 100)}%` : "--",
  );
  const title = $derived(`${doc.name} @ ${zoomLabel} (RGB/8)`);
</script>

<div class="app">
  <TitleBar {title} />

  <div class="workspace">
    <Toolbar bind:active={activeTool} />

    <main class="center">
      <div class="options-bar">
        <span class="tool-name">{activeTool}</span>
        <span class="sep"></span>
        <span class="muted">Tool options will appear here.</span>
      </div>
      <CanvasView
        docWidth={doc.width}
        docHeight={doc.height}
        onready={(info) => (canvasInfo = info)}
      />
    </main>

    <RightPanel />
  </div>

  <footer class="statusbar">
    <span>{doc.width} x {doc.height} px</span>
    <span class="sep"></span>
    <span>Zoom {zoomLabel}</span>
    <span class="grow"></span>
    {#if canvasInfo}
      <span class="gl" class:ok={canvasInfo.webgl2} class:bad={!canvasInfo.webgl2}>
        {canvasInfo.webgl2 ? "WebGL2" : "WebGL2 unavailable"}
      </span>
      <span class="muted mono">{canvasInfo.renderer}</span>
    {/if}
  </footer>
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: var(--titlebar-h) 1fr var(--statusbar-h);
    height: 100%;
    background: var(--bg-0);
  }

  .workspace {
    display: grid;
    grid-template-columns: var(--toolbar-w) 1fr var(--panel-w);
    min-height: 0;
  }

  .center {
    display: grid;
    grid-template-rows: 34px 1fr;
    min-width: 0;
    min-height: 0;
  }

  .options-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
  }

  .tool-name {
    text-transform: capitalize;
    font-weight: 600;
    color: var(--fg-0);
  }

  .statusbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--fg-1);
  }

  .sep {
    width: 1px;
    height: 14px;
    background: var(--border-strong);
  }

  .grow {
    flex: 1;
  }

  .muted {
    color: var(--fg-2);
  }

  .mono {
    font-family: var(--font-mono);
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gl {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    font-weight: 600;
  }
  .gl.ok {
    color: var(--accent-2);
    background: rgba(34, 211, 238, 0.12);
  }
  .gl.bad {
    color: var(--danger);
    background: rgba(255, 92, 122, 0.12);
  }
</style>
