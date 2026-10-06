<script lang="ts">
  /**
   * Dev-only GPU-vs-CPU check. Runs every op with default params on the same test raster
   * through both backends and shows them side by side with a max / mean difference.
   * Mount anywhere in the real webview (jsdom has no WebGL2): `<FiltersDemo />`.
   */
  import { onMount } from "svelte";
  import { Raster, Rect } from "$lib/engine";
  import { GpuOp } from "../gpu";
  import { runOp } from "../apply";
  import { ALL_OPS } from "../ops";
  import { convolve1d, fromPremul, gaussianKernel, toPremul } from "../cpu";
  import { defaultParams, type OpDef, type ParamValues } from "../types";

  interface Row {
    op: OpDef;
    params: ParamValues;
    cpu: Raster | null;
    gpu: Raster | null;
    cpuMs: number;
    gpuMs: number;
    maxDiff: number;
    maxDiffOpaque: number;
    meanDiff: number;
    error: string | null;
    /** Extra readout (e.g. error of each path against an exact reference). */
    note?: string;
  }

  /** Exact (non-approximated) separable Gaussian for reference, premultiplied. */
  function exactGaussian(src: Raster, sigma: number): Raster {
    const k = gaussianKernel(sigma, 4096);
    const f = toPremul(src);
    const t = new Float32Array(f.length);
    const o = new Float32Array(f.length);
    convolve1d(f, t, src.width, src.height, k, "x");
    convolve1d(t, o, src.width, src.height, k, "y");
    return fromPremul(o, src.width, src.height);
  }

  /** Overrides to exercise interesting paths (big blur = downsample path). */
  const OVERRIDES: Record<string, ParamValues> = {
    "gaussian-blur": { radius: 6 },
    "unsharp-mask": { amount: 150, radius: 2, threshold: 4 },
    "hue-saturation": { hue: 60, saturation: 30, lightness: 10, colorize: false },
    "color-balance": { cyanRed_midtones: 40, yellowBlue_shadows: -30, preserveLuminosity: true },
    levels: { inBlack: 20, inWhite: 230, gamma: 1.3, inBlack_r: 10 },
    "brightness-contrast": { brightness: 20, contrast: 30 },
    exposure: { exposure: 0.5, offset: 0.02, gamma: 1.2 },
    "motion-blur": { angle: 30, distance: 16 },
    "add-noise": { amount: 20, distribution: "gaussian", monochrome: false, seed: 7 },
  };

  let rows = $state<Row[]>([]);
  let gpuInfo = $state("");
  let bigBlur = $state<Row | null>(null);

  function testRaster(w = 160, h = 120): Raster {
    const r = new Raster(w, h);
    const d = r.data;
    let i = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        d[i] = (x / w) * 255;
        d[i + 1] = (y / h) * 255;
        d[i + 2] = 255 - ((x + y) / (w + h)) * 255;
        const dist = Math.hypot(x - w * 0.6, y - h * 0.5);
        d[i + 3] = dist < 30 ? 0 : dist < 36 ? ((dist - 30) / 6) * 255 : 255;
        if (((x >> 3) + (y >> 3)) % 7 === 0) d[i] = d[i + 1] = d[i + 2] = 255;
      }
    }
    return r;
  }

  /** Max over all bytes, max over pixels whose CPU alpha >= 16 (RGB under near-zero alpha is noise), mean. */
  function diff(a: Raster, b: Raster): { max: number; maxOpaque: number; mean: number } {
    let max = 0;
    let maxOpaque = 0;
    let sum = 0;
    for (let i = 0; i < a.data.length; i++) {
      const d = Math.abs(a.data[i]! - b.data[i]!);
      if (d > max) max = d;
      if (a.data[i - (i % 4) + 3]! >= 16 && d > maxOpaque) maxOpaque = d;
      sum += d;
    }
    return { max, maxOpaque, mean: sum / a.data.length };
  }

  function runRow(op: OpDef, src: Raster, params: ParamValues): Row {
    const row: Row = { op, params, cpu: null, gpu: null, cpuMs: 0, gpuMs: 0, maxDiff: 0, maxDiffOpaque: 0, meanDiff: 0, error: null };
    let t = performance.now();
    row.cpu = runOp(op, src, params, "cpu").raster;
    row.cpuMs = performance.now() - t;
    try {
      t = performance.now();
      row.gpu = runOp(op, src, params, "gpu").raster;
      row.gpuMs = performance.now() - t;
      const d = diff(row.cpu, row.gpu);
      row.maxDiff = d.max;
      row.maxDiffOpaque = d.maxOpaque;
      row.meanDiff = d.mean;
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
    }
    return row;
  }

  function draw(node: HTMLCanvasElement, raster: Raster | null): { update: (r: Raster | null) => void } {
    const paint = (r: Raster | null): void => {
      if (!r) return;
      node.width = r.width;
      node.height = r.height;
      node.getContext("2d")?.putImageData(r.toImageData(), 0, 0);
    };
    paint(raster);
    return { update: paint };
  }

  onMount(() => {
    const gpu = GpuOp.shared();
    if (gpu) {
      const dbg = gpu.gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = dbg ? String(gpu.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "unknown renderer";
      gpuInfo = `WebGL2 available (${renderer}, max texture ${gpu.maxSize}, ${gpu.floatIntermediates ? "RGBA16F" : "RGBA8"} intermediates)`;
    } else {
      gpuInfo = "WebGL2 unavailable: every op runs on the CPU.";
    }
    const src = testRaster();
    rows = ALL_OPS.map((op) => runRow(op, src, { ...defaultParams(op), ...(OVERRIDES[op.id] ?? {}) }));
    const big = runRow(ALL_OPS.find((o) => o.id === "gaussian-blur")!, src, { radius: 40 });
    const ref = exactGaussian(src, 40);
    // Whole image, and the interior only (the 160x120 test image is all "near an edge" at sigma 40).
    const inner = Rect.make(50, 30, 60, 60);
    const dc = diff(ref, big.cpu!);
    const dci = diff(ref.crop(inner), big.cpu!.crop(inner));
    big.note = `vs exact kernel: CPU box×3 max ${dc.maxOpaque} (interior ${dci.maxOpaque}) / mean ${dc.mean.toFixed(2)}`;
    if (big.gpu) {
      const dg = diff(ref, big.gpu);
      const dgi = diff(ref.crop(inner), big.gpu.crop(inner));
      big.note += `; GPU downsample max ${dg.maxOpaque} (interior ${dgi.maxOpaque}) / mean ${dg.mean.toFixed(2)}`;
    }
    bigBlur = big;
  });
</script>

<div class="demo">
  <header>
    <h2>Filters: GPU vs CPU</h2>
    <p class="mono">{gpuInfo}</p>
  </header>
  <table>
    <thead>
      <tr><th>Op</th><th>CPU</th><th>GPU</th><th>max Δ (α≥16)</th><th>max Δ (all)</th><th>mean Δ</th><th>CPU ms</th><th>GPU ms</th></tr>
    </thead>
    <tbody>
      {#each [...rows, ...(bigBlur ? [bigBlur] : [])] as row (row.op.id + JSON.stringify(row.params))}
        <tr class:bad={row.error !== null || row.maxDiffOpaque > 8}>
          <td>
            <strong>{row.op.label}</strong>
            <div class="mono small">{JSON.stringify(row.params)}</div>
            {#if row.error}<div class="err mono small">{row.error}</div>{/if}
            {#if row.note}<div class="mono small">{row.note}</div>{/if}
          </td>
          <td><canvas use:draw={row.cpu}></canvas></td>
          <td><canvas use:draw={row.gpu}></canvas></td>
          <td class="mono">{row.gpu ? row.maxDiffOpaque : "—"}</td>
          <td class="mono">{row.gpu ? row.maxDiff : "—"}</td>
          <td class="mono">{row.gpu ? row.meanDiff.toFixed(3) : "—"}</td>
          <td class="mono">{row.cpuMs.toFixed(1)}</td>
          <td class="mono">{row.gpu ? row.gpuMs.toFixed(1) : "—"}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="note">
    Expected: max Δ ≤ 2 for point ops, ≤ 8 for blurs (float vs. LUT rounding, box-blur approximation above σ 20).
    Rows above that are highlighted.
  </p>
</div>

<style>
  .demo {
    padding: 16px;
    color: var(--fg-0, #eef1f7);
    background: var(--bg-0, #0b0d12);
    font: 12px/1.4 system-ui, sans-serif;
    overflow: auto;
    height: 100%;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 15px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    vertical-align: top;
  }
  canvas {
    display: block;
    width: 160px;
    height: 120px;
    image-rendering: pixelated;
    background: repeating-conic-gradient(#2a2e3a 0 25%, #1a1e27 0 50%) 0 0 / 16px 16px;
  }
  tr.bad td {
    background: rgba(255, 92, 122, 0.08);
  }
  .mono {
    font-family: Consolas, "Cascadia Code", monospace;
  }
  .small {
    font-size: 10px;
    color: #8b93a7;
    max-width: 260px;
    white-space: normal;
    word-break: break-all;
  }
  .err {
    color: #ff5c7a;
  }
  .note {
    color: #8b93a7;
  }
</style>
