<script lang="ts">
  /**
   * 256-bin histogram: red/green/blue as translucent additive fills, luma as a cyan line.
   * Pass `overlay` to draw a second (preview) luma curve dashed on top.
   */
  import { histogramPeak } from "../histogram";
  import type { Histogram } from "../types";

  interface Props {
    hist: Histogram | null;
    overlay?: Histogram | null;
    height?: number;
  }

  let { hist, overlay = null, height = 88 }: Props = $props();
  let canvas = $state<HTMLCanvasElement | null>(null);

  function drawBins(ctx: CanvasRenderingContext2D, bins: Uint32Array, peak: number, w: number, h: number, fill: string): void {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      const v = Math.min(1, bins[i]! / peak);
      ctx.lineTo((i / 255) * w, h - v * (h - 2));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawLine(ctx: CanvasRenderingContext2D, bins: Uint32Array, peak: number, w: number, h: number, stroke: string, dash: number[]): void {
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const v = Math.min(1, bins[i]! / peak);
      const x = (i / 255) * w;
      const y = h - v * (h - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.setLineDash(dash);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  $effect(() => {
    const el = canvas;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth || 256;
    const h = height;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Quarter grid.
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = Math.round((w * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    const src = hist;
    if (!src || src.count === 0) {
      ctx.fillStyle = "rgba(170,177,194,0.6)";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText("No pixels in range", 8, h / 2 + 4);
      return;
    }
    const peak = Math.max(histogramPeak(src.r), histogramPeak(src.g), histogramPeak(src.b));
    ctx.globalCompositeOperation = "lighter";
    drawBins(ctx, src.r, peak, w, h, "rgba(255, 70, 90, 0.42)");
    drawBins(ctx, src.g, peak, w, h, "rgba(70, 230, 120, 0.38)");
    drawBins(ctx, src.b, peak, w, h, "rgba(80, 120, 255, 0.46)");
    ctx.globalCompositeOperation = "source-over";
    drawLine(ctx, src.l, histogramPeak(src.l), w, h, "rgba(34, 211, 238, 0.95)", []);
    if (overlay && overlay.count > 0) {
      drawLine(ctx, overlay.l, histogramPeak(overlay.l), w, h, "rgba(238, 241, 247, 0.9)", [3, 3]);
    }
  });
</script>

<div class="histogram" style:height="{height}px">
  <canvas bind:this={canvas} aria-label="Histogram"></canvas>
  <div class="scale" aria-hidden="true">
    <span>0</span><span>64</span><span>128</span><span>192</span><span>255</span>
  </div>
</div>

<style>
  .histogram {
    position: relative;
    width: 100%;
    background: var(--bg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .scale {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 1px;
    display: flex;
    justify-content: space-between;
    padding: 0 3px;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--fg-2);
    pointer-events: none;
  }
</style>
