<script lang="ts">
  /**
   * One per open document. Owns the GL/2D canvas (compositor) and a 2D overlay canvas
   * for tool graphics. Only the active view runs its render loop and talks to the
   * canvas host; inactive views are hidden but keep their compositor warm.
   */
  import { createCompositor, type ICompositor, type RenderStats, type ViewportState } from "$lib/engine";
  import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { TextTool, type ToolEvent } from "$lib/tools";
  import { canvasHost, type CanvasImpl } from "./canvas/host.svelte";

  interface Props {
    entry: OpenDoc;
    active: boolean;
  }
  let { entry, active }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let overlay = $state<HTMLCanvasElement | null>(null);
  let textInput = $state<HTMLInputElement | null>(null);
  let cursor = $state("default");
  let cssW = $state(0);
  let cssH = $state(0);
  let stats = $state<RenderStats | null>(null);

  let compositor: ICompositor | null = null;
  let overlayDirty = true;
  let fitted = false;
  let lastVersion = -1;
  let lastVp: ViewportState | null = null;
  let lastAnts = -1;
  let lastW = 0;
  let lastH = 0;
  let lastDpr = 0;

  // Pointer state.
  let panning: { x: number; y: number } | null = null;
  let toolDown = false;

  const impl: CanvasImpl = {
    get entry() {
      return entry;
    },
    viewSize: () => ({ w: cssW, h: cssH }),
    invalidateOverlay: () => {
      overlayDirty = true;
    },
    setCursor: (c) => {
      cursor = c;
    },
    focus: () => host?.focus(),
  };

  // Mount compositor + resize observer once the elements exist.
  $effect(() => {
    const el = canvas;
    const container = host;
    if (!el || !container) return;
    try {
      compositor = createCompositor(el);
    } catch (e) {
      console.error("[pixelforge] no compositor", e);
      return;
    }
    entry.compositor = compositor;
    if (active) canvasHost.compositorKind = compositor.kind;
    const ro = new ResizeObserver(() => {
      cssW = Math.max(1, container.clientWidth);
      cssH = Math.max(1, container.clientHeight);
      if (active) canvasHost.setViewSize(cssW, cssH);
      overlayDirty = true;
    });
    ro.observe(container);
    cssW = Math.max(1, container.clientWidth);
    cssH = Math.max(1, container.clientHeight);
    return () => {
      ro.disconnect();
      if (entry.compositor === compositor) {
        compositor?.dispose();
        entry.compositor = null;
      }
      compositor = null;
    };
  });

  // Register with the host and run the render loop while active.
  $effect(() => {
    if (!active || !host) return;
    canvasHost.register(impl);
    canvasHost.setViewSize(cssW, cssH);
    let raf = 0;
    let alive = true;
    const frame = (t: number): void => {
      if (!alive) return;
      render(t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // Hidden views have a stale size; force a fresh fit check and overlay draw.
    overlayDirty = true;
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      canvasHost.unregister(impl);
    };
  });

  function render(t: number): void {
    const c = compositor;
    const ov = overlay;
    if (!c || !ov || cssW < 2 || cssH < 2) return;
    const doc = entry.doc;
    const vp = entry.viewport;
    const dpr = window.devicePixelRatio || 1;
    if (!fitted) {
      vp.fitToView(cssW, cssH, doc.width, doc.height, 32);
      fitted = true;
      // Let the status bar / title pick up the fitted zoom.
      docStore.touch();
    }
    const hasSel = !doc.selection.isEmpty && ui.showSelectionEdges;
    const ants = hasSel ? Math.floor(t / 80) % 8 : 0;
    const sizeChanged = cssW !== lastW || cssH !== lastH || dpr !== lastDpr;
    const vpChanged = !lastVp || !vp.equals(lastVp);
    const need = sizeChanged || vpChanged || entry.version !== lastVersion || ants !== lastAnts;
    if (need) {
      stats = c.render(doc, vp, {
        width: Math.round(cssW * dpr),
        height: Math.round(cssH * dpr),
        dpr,
        antsPhase: ants,
        showSelection: ui.showSelectionEdges,
        showPixelGrid: ui.showPixelGrid,
        activeLayerId: doc.activeLayerId,
      });
      lastVersion = entry.version;
      lastVp = vp.toState();
      lastAnts = ants;
      lastW = cssW;
      lastH = cssH;
      lastDpr = dpr;
      overlayDirty = true;
    }
    if (overlayDirty) {
      overlayDirty = false;
      drawOverlay(ov, dpr);
    }
  }

  function drawOverlay(ov: HTMLCanvasElement, dpr: number): void {
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (ov.width !== w || ov.height !== h) {
      ov.width = w;
      ov.height = h;
    }
    const g = ov.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    const tool = canvasHost.activeTool;
    const ctx = canvasHost.context(tool);
    if (ctx && tool.drawOverlay) tool.drawOverlay(g, ctx);
  }

  // ------------------------------------------------------------------ pointer

  function toEvent(e: PointerEvent): ToolEvent {
    const r = host!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const d = entry.viewport.screenToDoc({ x: sx, y: sy });
    return {
      x: d.x,
      y: d.y,
      screenX: sx,
      screenY: sy,
      pressure: e.pointerType === "mouse" ? 0.5 : e.pressure,
      pointerType: e.pointerType,
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
  }

  function onPointerDown(e: PointerEvent): void {
    if (!active || !host) return;
    host.focus();
    if (ui.textEdit) return; // the inline editor owns input until committed
    host.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && toolStore.tempToolId === "hand" && canvasHost.selectedTool.id !== "hand")) {
      panning = { x: e.clientX, y: e.clientY };
      cursor = "grabbing";
      e.preventDefault();
      return;
    }
    if (e.button === 2) return;
    const tool = canvasHost.activeTool;
    const ctx = canvasHost.context(tool);
    if (!ctx) return;
    toolDown = true;
    tool.onPointerDown(toEvent(e), ctx);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!active || !host) return;
    const r = host.getBoundingClientRect();
    const d = entry.viewport.screenToDoc({ x: e.clientX - r.left, y: e.clientY - r.top });
    ui.cursorDoc = { x: Math.floor(d.x), y: Math.floor(d.y) };
    if (panning) {
      entry.viewport.panBy(e.clientX - panning.x, e.clientY - panning.y);
      panning = { x: e.clientX, y: e.clientY };
      docStore.touch();
      return;
    }
    const tool = canvasHost.activeTool;
    const ctx = canvasHost.context(tool);
    if (!ctx) return;
    if (toolDown && typeof e.getCoalescedEvents === "function") {
      const list = e.getCoalescedEvents();
      if (list.length > 1) {
        for (const ce of list) tool.onPointerMove(toEvent(ce), ctx);
        return;
      }
    }
    tool.onPointerMove(toEvent(e), ctx);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!active || !host) return;
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    if (panning) {
      panning = null;
      canvasHost.applyToolCursor();
      return;
    }
    if (!toolDown) return;
    toolDown = false;
    const tool = canvasHost.activeTool;
    const ctx = canvasHost.context(tool);
    if (ctx) tool.onPointerUp(toEvent(e), ctx);
  }

  function onPointerLeave(): void {
    ui.cursorDoc = null;
  }

  function onWheel(e: WheelEvent): void {
    if (!active || !host) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
    const vp = entry.viewport;
    if (e.shiftKey && !e.ctrlKey) {
      vp.panBy(-e.deltaY, 0);
    } else if (e.altKey && !e.ctrlKey) {
      vp.panBy(0, -e.deltaY);
    } else if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas: smooth exponential zoom.
      vp.zoomAt(pt, Math.exp(-e.deltaY * 0.01));
    } else {
      const lines = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      vp.zoomAt(pt, lines < 0 ? 1.2 : 1 / 1.2);
    }
    docStore.touch();
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  // ------------------------------------------------------------------ text editor

  const textPos = $derived.by(() => {
    const t = ui.textEdit;
    if (!t || !active) return null;
    void entry.version;
    const s = entry.viewport.docToScreen({ x: t.docX, y: t.docY });
    const size = toolStore.option("text", "size", 48) * entry.viewport.zoom;
    return { x: s.x, y: s.y, size };
  });

  $effect(() => {
    if (textPos && textInput) textInput.focus();
  });

  function commitText(): void {
    const t = ui.textEdit;
    if (!t) return;
    const value = t.value;
    ui.textEdit = null;
    const tool = canvasHost.selectedTool;
    const ctx = canvasHost.context(tool);
    if (!(tool instanceof TextTool) || !ctx || !value.trim()) return;
    tool.commit(ctx, value, t.docX, t.docY);
  }

  function onTextKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitText();
    } else if (e.key === "Escape") {
      e.preventDefault();
      ui.textEdit = null;
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="host"
  class:hidden={!active}
  bind:this={host}
  tabindex="0"
  role="application"
  aria-label="Document view"
  style:cursor
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={onPointerLeave}
  onwheel={onWheel}
  oncontextmenu={onContextMenu}
>
  <!-- Only the active view's canvas carries the label other modules locate it by. -->
  <canvas class="gl" bind:this={canvas} aria-label={active ? "Document canvas" : "Inactive document canvas"}></canvas>
  <canvas class="overlay" bind:this={overlay} aria-hidden="true"></canvas>
  {#if textPos && ui.textEdit}
    <input
      class="text-edit"
      type="text"
      bind:this={textInput}
      bind:value={ui.textEdit.value}
      onkeydown={onTextKey}
      onblur={commitText}
      style:left="{textPos.x}px"
      style:top="{textPos.y}px"
      style:font-size="{Math.max(8, textPos.size)}px"
      style:font-family={toolStore.option("text", "family", "Segoe UI")}
      style:font-weight={toolStore.option("text", "bold", false) ? 700 : 400}
      style:font-style={toolStore.option("text", "italic", false) ? "italic" : "normal"}
      placeholder="Type…"
      spellcheck="false"
    />
  {/if}
  {#if import.meta.env.DEV && stats && active}
    <span class="stats" aria-hidden="true">{stats.passes}p {stats.uploads}u</span>
  {/if}
</div>

<style>
  .host {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--bg-0);
    outline: none;
    touch-action: none;
  }
  .host.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .overlay {
    pointer-events: none;
  }
  .text-edit {
    position: absolute;
    transform: translateY(-80%);
    min-width: 120px;
    padding: 0 4px;
    background: rgba(10, 12, 17, 0.6);
    border: 1px dashed var(--accent);
    border-radius: 2px;
    color: #fff;
    outline: none;
    line-height: 1.2;
  }
  .stats {
    position: absolute;
    right: 6px;
    top: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-2);
    opacity: 0.6;
    pointer-events: none;
  }
</style>
