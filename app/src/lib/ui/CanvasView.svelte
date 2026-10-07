<script lang="ts">
  /**
   * One per open document. Owns the GL/2D canvas (compositor) and a 2D overlay canvas
   * for tool graphics. Only the active view runs its render loop and talks to the
   * canvas host; inactive views are hidden but keep their compositor warm.
   *
   * Chrome owned by the shell: PS pasteboard, document frame (1 px dark border + soft
   * shadow), rulers (View ▸ Rulers, Ctrl+R) with cursor markers, transparency grid prefs.
   */
  import { createCompositor, type ICompositor, type RenderStats, type ViewportState } from "$lib/engine";
  import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { settings, CHECKER_PX, CHECKER_RGB } from "$lib/stores/settings.svelte";
  import { type ToolEvent } from "$lib/tools";
  import TypeEditor from "$lib/tools/ui/TypeEditor.svelte";
  import { typeSession } from "$lib/tools/type-session.svelte";
  import { canvasHost, type CanvasImpl } from "./canvas/host.svelte";
  import { paintRuler } from "./rulers";

  interface Props {
    entry: OpenDoc;
    active: boolean;
  }
  let { entry, active }: Props = $props();

  const RULER = 16;

  let host = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let overlay = $state<HTMLCanvasElement | null>(null);
  let rulerH = $state<HTMLCanvasElement | null>(null);
  let rulerV = $state<HTMLCanvasElement | null>(null);
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
  let lastRulerKey = "";
  let lastChecker = -1;
  let lastViewChannel = "rgb";

  // Pointer state.
  let panning: { x: number; y: number } | null = null;
  let toolDown = false;

  const rulers = $derived(ui.showRulers);

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

  function cssRgb(name: string, fallback: [number, number, number]): [number, number, number] {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return fallback;
    const n = parseInt(m[1]!, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // Mount compositor + resize observer once the elements exist. Re-created when the
  // transparency-grid colors or theme change (compositor colors are fixed at creation).
  $effect(() => {
    const el = canvas;
    const container = host;
    const gridColors = settings.value.checkerColors;
    void settings.value.theme;
    if (!el || !container) return;
    const [light, dark] = CHECKER_RGB[gridColors] ?? CHECKER_RGB.light;
    try {
      // glow = black: the present shader draws a 1 px `glow` line around the document and
      // a soft halo in the pasteboard — black gives PS's hairline and no halo.
      compositor = createCompositor(el, { colors: { light, dark, bg: cssRgb("--ps-canvas-bg", [0.157, 0.157, 0.157]), glow: [0, 0, 0] } });
    } catch (e) {
      console.error("[pixelforge] no compositor", e);
      return;
    }
    entry.compositor = compositor;
    if (active) canvasHost.compositorKind = compositor.kind;
    lastVersion = -1;
    lastVp = null;
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

  function checkerSizePx(dpr: number): number {
    const px = CHECKER_PX[settings.value.checkerSize] ?? 8;
    // "None": one giant cell → the light color only.
    return px === 0 ? 1e6 : Math.round(px * dpr);
  }

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
    const checker = checkerSizePx(dpr);
    const viewChannel = ui.viewChannel;
    const need = sizeChanged || vpChanged || entry.version !== lastVersion || ants !== lastAnts || checker !== lastChecker || viewChannel !== lastViewChannel;
    if (need) {
      lastChecker = checker;
      lastViewChannel = viewChannel;
      const t0 = performance.now();
      stats = c.render(doc, vp, {
        width: Math.round(cssW * dpr),
        height: Math.round(cssH * dpr),
        dpr,
        antsPhase: ants,
        showSelection: ui.showSelectionEdges,
        showPixelGrid: ui.showPixelGrid,
        checkerSize: checker,
        activeLayerId: doc.activeLayerId,
        viewChannel,
      });
      if (sizeChanged || vpChanged || entry.version !== lastVersion) ui.lastRenderMs = performance.now() - t0;
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
    if (rulers) drawRulers(dpr);
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

  function drawRulers(dpr: number): void {
    const rh = rulerH;
    const rv = rulerV;
    if (!rh || !rv) return;
    const vp = entry.viewport;
    const cur = ui.cursorDoc;
    const unit = settings.value.rulerUnit;
    const key = `${cssW}:${cssH}:${dpr}:${vp.zoom}:${vp.panX}:${vp.panY}:${unit}:${cur?.x}:${cur?.y}:${settings.value.theme}`;
    if (key === lastRulerKey) return;
    lastRulerKey = key;
    const cs = getComputedStyle(document.documentElement);
    const colors = {
      bg: cs.getPropertyValue("--ps-ruler").trim() || "#3c3c3c",
      tick: cs.getPropertyValue("--ps-ruler-tick").trim() || "#a0a0a0",
      text: cs.getPropertyValue("--ps-ruler-tick").trim() || "#a0a0a0",
      border: cs.getPropertyValue("--ps-border-dark").trim() || "#1e1e1e",
      cursor: cs.getPropertyValue("--ps-text").trim() || "#e6e6e6",
    };
    const sizeH = { w: Math.round(cssW * dpr), h: Math.round(RULER * dpr) };
    if (rh.width !== sizeH.w || rh.height !== sizeH.h) {
      rh.width = sizeH.w;
      rh.height = sizeH.h;
    }
    const sizeV = { w: Math.round(RULER * dpr), h: Math.round(cssH * dpr) };
    if (rv.width !== sizeV.w || rv.height !== sizeV.h) {
      rv.width = sizeV.w;
      rv.height = sizeV.h;
    }
    const gh = rh.getContext("2d");
    const gv = rv.getContext("2d");
    if (!gh || !gv) return;
    const o = vp.docToScreen({ x: 0, y: 0 });
    const cs2 = cur ? vp.docToScreen({ x: cur.x, y: cur.y }) : null;
    const dpi = entry.doc.meta.dpi || 72;
    paintRuler(gh, { axis: "h", length: cssW, origin: o.x, zoom: vp.zoom, unit, dpi, docAxisPx: entry.doc.width, cursor: cs2?.x ?? null, dpr, colors }, RULER);
    paintRuler(gv, { axis: "v", length: cssH, origin: o.y, zoom: vp.zoom, unit, dpi, docAxisPx: entry.doc.height, cursor: cs2?.y ?? null, dpr, colors }, RULER);
  }

  // Document frame: PS draws a hairline + soft shadow around the canvas on the pasteboard.
  const frame = $derived.by(() => {
    void entry.version;
    const vp = entry.viewport;
    if (vp.rotation !== 0 || cssW < 2) return null;
    const a = vp.docToScreen({ x: 0, y: 0 });
    const b = vp.docToScreen({ x: entry.doc.width, y: entry.doc.height });
    return { x: Math.round(a.x), y: Math.round(a.y), w: Math.max(1, Math.round(b.x - a.x)), h: Math.max(1, Math.round(b.y - a.y)) };
  });

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
    const wheelZooms = settings.value.zoomWithWheel !== false;
    if (e.shiftKey && !e.ctrlKey) {
      vp.panBy(-e.deltaY, 0);
    } else if (e.altKey && !e.ctrlKey) {
      vp.panBy(0, -e.deltaY);
    } else if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas: smooth exponential zoom.
      vp.zoomAt(pt, Math.exp(-e.deltaY * 0.01));
    } else if (wheelZooms) {
      const lines = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      vp.zoomAt(pt, lines < 0 ? 1.2 : 1 / 1.2);
    } else {
      vp.panBy(0, -e.deltaY);
    }
    docStore.touch();
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  // Type tool editing: the hidden editor (tools-v2) lives in this view while a session is active.
  const typing = $derived(active && typeSession.active && !!ui.textEdit);
</script>

<div class="view" class:hidden={!active} class:rulers>
  {#if rulers}
    <div class="corner" aria-hidden="true"></div>
    <canvas class="ruler h" bind:this={rulerH} aria-hidden="true"></canvas>
    <canvas class="ruler v" bind:this={rulerV} aria-hidden="true"></canvas>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="host"
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
    {#if frame}
      <div class="frame" aria-hidden="true" style:left="{frame.x}px" style:top="{frame.y}px" style:width="{frame.w}px" style:height="{frame.h}px"></div>
    {/if}
    <canvas class="overlay" bind:this={overlay} aria-hidden="true"></canvas>
    {#if typing}
      <TypeEditor {entry} />
    {/if}
    {#if import.meta.env.DEV && stats && active}
      <span class="stats" aria-hidden="true">{stats.passes}p {stats.uploads}u</span>
    {/if}
  </div>
</div>

<style>
  .view {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
    background: var(--ps-canvas-bg);
  }
  .view.rulers {
    grid-template-columns: var(--ruler-size) 1fr;
    grid-template-rows: var(--ruler-size) 1fr;
  }
  .view.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .corner {
    background: var(--ps-ruler);
    border-right: 1px solid var(--ps-border-dark);
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .ruler {
    display: block;
  }
  .ruler.h {
    width: 100%;
    height: var(--ruler-size);
  }
  .ruler.v {
    width: var(--ruler-size);
    height: 100%;
  }
  .host {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--ps-canvas-bg);
    outline: none;
    touch-action: none;
  }
  canvas.gl,
  canvas.overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .overlay {
    pointer-events: none;
  }
  .frame {
    position: absolute;
    pointer-events: none;
    box-shadow:
      0 0 0 1px var(--ps-border-dark),
      0 2px 10px rgba(0, 0, 0, 0.55);
  }
  .stats {
    position: absolute;
    right: 6px;
    top: 4px;
    font-size: 10px;
    color: var(--ps-text-disabled);
    opacity: 0.7;
    pointer-events: none;
  }
</style>
