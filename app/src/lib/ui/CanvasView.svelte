<script lang="ts" module>
  /** What the canvas reports upward once a GL context is (or is not) available. */
  export interface CanvasInfo {
    webgl2: boolean;
    renderer: string;
    zoom: number;
  }
</script>

<script lang="ts">
  /**
   * Central document view. For the scaffold it draws the transparency checkerboard
   * through a WebGL2 fragment shader (proving the context works inside the Tauri
   * webview) sized to a centred, fitted document rectangle. The real compositor
   * (engine wave) replaces the draw call, not the host.
   */
  import { createCheckerboard } from "./canvas/checkerboard";
  import { fitRect } from "./canvas/fit";

  interface Props {
    docWidth?: number;
    docHeight?: number;
    onready?: (info: CanvasInfo) => void;
  }

  let { docWidth = 1024, docHeight = 768, onready }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let failed = $state(false);

  $effect(() => {
    const el = canvas;
    const container = host;
    if (!el || !container) return;

    const gl = el.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      failed = true;
      onready?.({ webgl2: false, renderer: "none", zoom: 0 });
      return;
    }

    const board = createCheckerboard(gl);
    const renderer = `${String(gl.getParameter(gl.VERSION))} / ${String(gl.getParameter(gl.RENDERER))}`;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(1, container.clientWidth);
      const cssH = Math.max(1, container.clientHeight);
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      const rect = fitRect(docWidth, docHeight, w, h, Math.round(40 * dpr));
      board.draw(w, h, rect, 8 * dpr);
      onready?.({ webgl2: true, renderer, zoom: rect.zoom });
    };

    const ro = new ResizeObserver(() => render());
    ro.observe(container);
    render();

    return () => {
      ro.disconnect();
      board.dispose();
    };
  });
</script>

<div class="host" bind:this={host}>
  <canvas bind:this={canvas} aria-label="Document canvas"></canvas>
  {#if failed}
    <div class="fallback">
      <strong>WebGL2 is not available in this webview.</strong>
      <span>Pixelforge needs WebGL2 for the compositor. Update your graphics driver / WebView2.</span>
    </div>
  {/if}
</div>

<style>
  .host {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-0);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 6px;
    text-align: center;
    color: var(--fg-1);
    padding: 24px;
  }
</style>
