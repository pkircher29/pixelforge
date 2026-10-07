<script lang="ts">
  /**
   * Photoshop's picker cube: a square (two fields) beside a vertical strip (the third
   * field), in any of the six H/S/B/R/G/B modes. Drag either to pick; the circle marker
   * flips to black over light colors. Pure geometry lives in `color-model.ts`.
   */
  import { cubeColor, cubePosition, luma, paintCube, paintStrip, rgbToHsb, type CubeMode, type CubePos, type HSB, type RGB } from "./color-model";

  interface Props {
    mode?: CubeMode;
    color: RGB;
    /** Hue/sat memory so the square doesn't jump at s = 0 or b = 0. */
    hsb: HSB;
    /** Square side in px (the strip matches its height). */
    size?: number;
    stripWidth?: number;
    onchange: (color: RGB, hsb: HSB) => void;
    /** Fired on pointer release (callers that record undo / persist). */
    oncommit?: (color: RGB, hsb: HSB) => void;
    /** Fill the available width instead of a fixed square (Color panel). */
    fluid?: boolean;
  }
  let { mode = "H", color, hsb, size = 192, stripWidth = 16, onchange, oncommit, fluid = false }: Props = $props();

  const RES = 128;
  let square = $state<HTMLCanvasElement | null>(null);
  let strip = $state<HTMLCanvasElement | null>(null);
  let squareEl = $state<HTMLDivElement | null>(null);
  let box = $state({ w: 0, h: 0 });

  const pos = $derived(cubePosition(mode, color, hsb));
  const dark = $derived(luma(color) > 150);

  // Square repaints when the strip value changes; strip repaints when the square point changes (non-H modes).
  const vKey = $derived(`${mode}:${Math.round(pos.v * 1000)}`);
  $effect(() => {
    void vKey;
    const el = square;
    if (!el) return;
    const g = el.getContext("2d");
    if (!g) return;
    if (el.width !== RES) {
      el.width = RES;
      el.height = RES;
    }
    const img = g.createImageData(RES, RES);
    paintCube(mode, pos.v, img.data, RES, RES);
    g.putImageData(img, 0, 0);
  });
  const uwKey = $derived(mode === "H" ? "H" : `${mode}:${Math.round(pos.u * 500)}:${Math.round(pos.w * 500)}`);
  $effect(() => {
    void uwKey;
    const el = strip;
    if (!el) return;
    const g = el.getContext("2d");
    if (!g) return;
    if (el.width !== 1 || el.height !== 256) {
      el.width = 1;
      el.height = 256;
    }
    const img = g.createImageData(1, 256);
    paintStrip(mode, pos, img.data, 1, 256);
    g.putImageData(img, 0, 0);
  });

  $effect(() => {
    const el = squareEl;
    if (!el || !fluid) return;
    const ro = new ResizeObserver(() => (box = { w: Math.max(8, el.clientWidth), h: Math.max(8, el.clientHeight) }));
    ro.observe(el);
    box = { w: Math.max(8, el.clientWidth), h: Math.max(8, el.clientHeight) };
    return () => ro.disconnect();
  });

  function hsbFor(next: CubePos): HSB {
    switch (mode) {
      case "H":
        return { h: Math.round((1 - next.v) * 3600) / 10, s: Math.round(next.u * 1000) / 10, b: Math.round(next.w * 1000) / 10 };
      case "S":
        return { h: Math.round(next.u * 3600) / 10, s: Math.round(next.v * 1000) / 10, b: Math.round(next.w * 1000) / 10 };
      case "B":
        return { h: Math.round(next.u * 3600) / 10, s: Math.round(next.w * 1000) / 10, b: Math.round(next.v * 1000) / 10 };
      default: {
        const c = cubeColor(mode, next);
        const h = rgbToHsb(c);
        return h.s === 0 ? { ...h, h: hsb.h } : h;
      }
    }
  }

  function emit(next: CubePos, commit: boolean): void {
    const h = hsbFor(next);
    const c = cubeColor(mode, next);
    onchange(c, h);
    if (commit) oncommit?.(c, h);
  }

  function drag(e: PointerEvent, pick: (ev: PointerEvent, r: DOMRect) => CubePos): void {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    emit(pick(e, r), false);
    const move = (ev: PointerEvent): void => emit(pick(ev, r), false);
    const up = (ev: PointerEvent): void => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      emit(pick(ev, r), true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    e.preventDefault();
  }

  const pickSquare = (ev: PointerEvent, r: DOMRect): CubePos => ({
    v: pos.v,
    u: Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))),
    w: 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(1, r.height))),
  });
  const pickStrip = (ev: PointerEvent, r: DOMRect): CubePos => ({
    v: 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(1, r.height))),
    u: pos.u,
    w: pos.w,
  });

  const sqW = $derived(fluid ? box.w : size);
  const sqH = $derived(fluid ? box.h : size);
</script>

<div class="cube" class:fluid style:--sq="{size}px" style:--strip="{stripWidth}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="square" bind:this={squareEl} onpointerdown={(e) => drag(e, pickSquare)}>
    <canvas bind:this={square} aria-hidden="true"></canvas>
    <span class="marker" class:dark style:left="{pos.u * sqW}px" style:top="{(1 - pos.w) * sqH}px"></span>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="strip" onpointerdown={(e) => drag(e, pickStrip)}>
    <canvas bind:this={strip} aria-hidden="true"></canvas>
    <span class="tri l" style:top="{(1 - pos.v) * 100}%"></span>
    <span class="tri r" style:top="{(1 - pos.v) * 100}%"></span>
  </div>
</div>

<style>
  .cube {
    display: flex;
    gap: 6px;
    align-items: stretch;
    height: var(--sq);
  }
  .cube.fluid {
    height: auto;
    flex: 1;
    min-height: 0;
  }
  .square {
    position: relative;
    width: var(--sq);
    height: var(--sq);
    flex: none;
    border: 1px solid var(--ps-border-dark);
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
  }
  .fluid .square {
    flex: 1;
    width: auto;
    height: auto;
    min-width: 0;
  }
  .square canvas,
  .strip canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: auto;
  }
  .marker {
    position: absolute;
    width: 9px;
    height: 9px;
    margin: -5px 0 0 -5px;
    border: 1px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .marker.dark {
    border-color: #000;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55);
  }
  .strip {
    position: relative;
    width: var(--strip);
    flex: none;
    border: 1px solid var(--ps-border-dark);
    cursor: ns-resize;
    touch-action: none;
  }
  .tri {
    position: absolute;
    width: 0;
    height: 0;
    margin-top: -4px;
    border: 4px solid transparent;
    pointer-events: none;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
  }
  .tri.l {
    left: -6px;
    border-left-color: #e6e6e6;
  }
  .tri.r {
    right: -6px;
    border-right-color: #e6e6e6;
  }
</style>
