<script lang="ts">
  /**
   * Navigator (PS): live composite thumbnail (≤ 256 px, re-rendered at most every
   * 150 ms and only when pixels changed), the red view box (drag to pan, click to
   * centre), and the zoom row: `[ 66.7% ] [−] ───●─── [+]`.
   */
  import { untrack } from "svelte";
  import { compositeToRaster, formatZoom, clampZoom, MIN_ZOOM, MAX_ZOOM, Rect, type Raster } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { canvasHost } from "../canvas/host.svelte";
  import Icon from "../icons/Icon.svelte";
  import { sampleRaster } from "./thumbnail";
  import { navigatorUi } from "./Navigator.store.svelte";
  import { clipBox, panByDrag, panToPoint, parseZoomPercent, showsWholeDoc, sliderToZoom, thumbLayout, viewBox, zoomToSlider } from "./navigator-math";

  const THROTTLE_MS = 150;
  const MAX_PX = 256;

  let area = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let areaW = $state(240);
  let areaH = $state(140);
  let editing = $state(false);
  let zoomText = $state("");
  let zoomInput = $state<HTMLInputElement | null>(null);

  const entry = $derived(docStore.active);
  const docSize = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    return { w: entry.doc.width, h: entry.doc.height };
  });
  const layout = $derived(docSize ? thumbLayout(docSize.w, docSize.h, areaW, areaH, MAX_PX) : null);
  const vp = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    return entry.viewport.toState();
  });
  const viewW = $derived(canvasHost.viewW);
  const viewH = $derived(canvasHost.viewH);
  const box = $derived.by(() => {
    if (!vp || !layout || !docSize) return null;
    const b = clipBox(viewBox(vp, viewW, viewH, layout), layout);
    return { ...b, whole: showsWholeDoc(vp, viewW, viewH, docSize.w, docSize.h) };
  });
  const zoom = $derived(vp?.zoom ?? 1);

  $effect(() => {
    const el = area;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      areaW = Math.max(16, el.clientWidth);
      areaH = Math.max(16, el.clientHeight);
    });
    ro.observe(el);
    areaW = Math.max(16, el.clientWidth);
    areaH = Math.max(16, el.clientHeight);
    return () => ro.disconnect();
  });

  // ---- throttled thumbnail ------------------------------------------------------
  let lastPainted = -1;
  let lastDocId = "";
  let lastSizeKey = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAt = 0;
  let scratch: Raster | null = null;

  function paint(): void {
    const e = docStore.active;
    const cv = canvas;
    const lay = layout;
    if (!e || !cv || !lay) return;
    const doc = e.doc;
    if (!scratch || scratch.width !== doc.width || scratch.height !== doc.height) scratch = null;
    const full = compositeToRaster(doc, scratch ? { into: scratch } : {});
    scratch = full;
    const tw = lay.w;
    const th = lay.h;
    if (cv.width !== tw || cv.height !== th) {
      cv.width = tw;
      cv.height = th;
    }
    const g = cv.getContext("2d");
    if (!g) return;
    // Checkerboard under transparency, PS-style.
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, tw, th);
    g.fillStyle = "#cbcbcb";
    for (let y = 0; y < th; y += 4) for (let x = ((y / 4) & 1) * 4; x < tw; x += 8) g.fillRect(x, y, 4, 4);
    const img = g.createImageData(tw, th);
    sampleRaster(full, { x: 0, y: 0 }, Rect.ofSize(doc.width, doc.height), img.data, tw, th);
    const tmp = document.createElement("canvas");
    tmp.width = tw;
    tmp.height = th;
    tmp.getContext("2d")?.putImageData(img, 0, 0);
    g.drawImage(tmp, 0, 0);
    lastPainted = e.pixelVersion;
    lastDocId = e.id;
    lastSizeKey = `${tw}x${th}`;
    lastAt = performance.now();
  }

  function schedule(): void {
    if (timer) return;
    const wait = Math.max(0, THROTTLE_MS - (performance.now() - lastAt));
    timer = setTimeout(() => {
      timer = null;
      paint();
    }, wait);
  }

  $effect(() => {
    const e = entry;
    const lay = layout;
    const pv = e?.pixelVersion ?? -1;
    if (!e || !lay || !canvas) return;
    const key = `${lay.w}x${lay.h}`;
    untrack(() => {
      if (pv !== lastPainted || e.id !== lastDocId || key !== lastSizeKey) schedule();
    });
  });
  $effect(() => () => {
    if (timer) clearTimeout(timer);
  });

  // ---- interaction ---------------------------------------------------------------
  function setPan(p: { panX: number; panY: number }): void {
    const e = docStore.active;
    if (!e) return;
    e.viewport.panX = p.panX;
    e.viewport.panY = p.panY;
    docStore.touch();
  }
  function onAreaDown(ev: PointerEvent): void {
    const e = docStore.active;
    const lay = layout;
    const b = box;
    if (!e || !lay || !b || ev.button !== 0 || !area) return;
    const r = area.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const inside = px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
    if (!inside) setPan(panToPoint(e.viewport, px, py, lay, canvasHost.viewW, canvasHost.viewH));
    let lx = ev.clientX;
    let ly = ev.clientY;
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const move = (m: PointerEvent): void => {
      const dx = m.clientX - lx;
      const dy = m.clientY - ly;
      lx = m.clientX;
      ly = m.clientY;
      const live = docStore.active;
      if (live && layout) setPan(panByDrag(live.viewport, dx, dy, layout));
    };
    const up = (): void => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    ev.preventDefault();
  }
  function setZoom(z: number): void {
    const e = docStore.active;
    if (!e) return;
    e.viewport.setZoomAt({ x: canvasHost.viewW / 2, y: canvasHost.viewH / 2 }, clampZoom(z));
    docStore.touch();
  }
  function startEdit(): void {
    zoomText = formatZoom(zoom).replace("%", "");
    editing = true;
    queueMicrotask(() => zoomInput?.select());
  }
  function commitEdit(): void {
    if (!editing) return;
    editing = false;
    const z = parseZoomPercent(zoomText);
    if (z !== null) setZoom(z);
  }
</script>

<div class="nav">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="area" bind:this={area} onpointerdown={onAreaDown}>
    {#if entry && layout}
      <canvas bind:this={canvas} class="thumb" style:left="{layout.x}px" style:top="{layout.y}px" style:width="{layout.w}px" style:height="{layout.h}px" aria-label="Document thumbnail"></canvas>
      {#if box}
        <div class="box" class:whole={box.whole} style:left="{box.x}px" style:top="{box.y}px" style:width="{Math.max(0, box.w)}px" style:height="{Math.max(0, box.h)}px" style:border-color={navigatorUi.boxCss}></div>
      {/if}
    {:else}
      <div class="empty">No document</div>
    {/if}
  </div>
  <div class="zoomrow">
    {#if editing}
      <input bind:this={zoomInput} bind:value={zoomText} class="input z" type="text" inputmode="decimal" onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); else if (e.key === "Escape") editing = false; }} onblur={commitEdit} aria-label="Zoom percent" />
    {:else}
      <button type="button" class="input z zbtn" disabled={!entry} onclick={startEdit} title="Zoom level — click to type">{entry ? formatZoom(zoom) : "--"}</button>
    {/if}
    <button type="button" class="icon-btn" disabled={!entry} aria-label="Zoom out" data-tip="Zoom Out" onclick={() => { const e = docStore.active; if (e) { e.viewport.zoomOut({ x: canvasHost.viewW / 2, y: canvasHost.viewH / 2 }); docStore.touch(); } }}><Icon name="zoom-out" size={14} /></button>
    <input type="range" class="slider" min="0" max="1000" step="1" disabled={!entry} value={Math.round(zoomToSlider(zoom, MIN_ZOOM, MAX_ZOOM) * 1000)} oninput={(e) => setZoom(sliderToZoom(Number(e.currentTarget.value) / 1000, MIN_ZOOM, MAX_ZOOM))} aria-label="Zoom" />
    <button type="button" class="icon-btn" disabled={!entry} aria-label="Zoom in" data-tip="Zoom In" onclick={() => { const e = docStore.active; if (e) { e.viewport.zoomIn({ x: canvasHost.viewW / 2, y: canvasHost.viewH / 2 }); docStore.touch(); } }}><Icon name="zoom-in" size={14} /></button>
  </div>
</div>

<style>
  .nav {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .area {
    position: relative;
    flex: 1;
    min-height: 60px;
    margin: 6px;
    background: var(--ps-canvas-bg);
    border: 1px solid var(--ps-border-dark);
    overflow: hidden;
    touch-action: none;
  }
  .thumb {
    position: absolute;
    display: block;
    box-shadow: 0 0 0 1px var(--ps-border-dark);
  }
  .box {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #ff4d4d;
    pointer-events: none;
  }
  .box.whole {
    opacity: 0.55;
  }
  .empty {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--ps-text-disabled);
  }
  .zoomrow {
    flex: none;
    display: flex;
    align-items: center;
    gap: 3px;
    height: 26px;
    padding: 0 6px 0 6px;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .z {
    width: 56px;
    text-align: left;
    font-variant-numeric: tabular-nums;
  }
  .zbtn {
    display: inline-flex;
    align-items: center;
  }
  .slider {
    flex: 1;
    min-width: 40px;
  }
</style>
