<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import type { ExportFormat, ExportOptions } from "$lib/io/files";

  export interface ExportResult {
    format: ExportFormat;
    opts: ExportOptions;
  }

  interface Props {
    width: number;
    height: number;
    resolve: Resolver<ExportResult>;
  }
  let { width, height, resolve }: Props = $props();

  let format = $state<ExportFormat>("png");
  let quality = $state(90);
  let lossless = $state(false);
  let pngBest = $state(false);
  let jpegBg = $state("#ffffff");

  function submit() {
    const opts: ExportOptions = {};
    if (format === "jpeg") {
      opts.quality = quality;
      const n = parseInt(jpegBg.slice(1), 16);
      opts.background = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else if (format === "webp") {
      opts.lossless = lossless;
      if (!lossless) opts.quality = quality;
    } else {
      opts.pngCompression = pngBest ? "best" : "fast";
    }
    resolve({ format, opts });
  }
</script>

<Dialog title="Export image" width={420} oncancel={() => resolve(null)} onsubmit={submit}>
  <div class="grid">
    <div class="row">
      <span>Format</span>
      <span class="seg" role="radiogroup">
        {#each [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]] as [v, l] (v)}
          <label class:on={format === v}><input type="radio" bind:group={format} value={v} />{l}</label>
        {/each}
      </span>
    </div>
    {#if format === "jpeg" || (format === "webp" && !lossless)}
      <label class="row">
        <span>Quality</span>
        <span class="slider">
          <input type="range" min="1" max="100" bind:value={quality} />
          <span class="val">{quality}</span>
        </span>
      </label>
    {/if}
    {#if format === "jpeg"}
      <label class="row">
        <span>Matte</span>
        <span class="slider">
          <input type="color" class="swatch" bind:value={jpegBg} />
          <span class="hint">transparent pixels are flattened onto this colour</span>
        </span>
      </label>
    {/if}
    {#if format === "webp"}
      <label class="row">
        <span>Lossless</span>
        <input type="checkbox" bind:checked={lossless} />
      </label>
    {/if}
    {#if format === "png"}
      <label class="row">
        <span>Smallest file</span>
        <span class="slider"><input type="checkbox" bind:checked={pngBest} /><span class="hint">slower to write</span></span>
      </label>
    {/if}
  </div>
  <p class="meta">{width} × {height} px, composite of visible layers</p>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={submit}>Export…</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 10px;
  }
  .row {
    display: grid;
    grid-template-columns: 96px 1fr;
    align-items: center;
    gap: 10px;
  }
  .row > span:first-child {
    color: var(--fg-1);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
    width: max-content;
  }
  .seg label {
    padding: 5px 14px;
    color: var(--fg-1);
    transition: background var(--t-fast) ease-out;
  }
  .seg label + label {
    border-left: 1px solid var(--border);
  }
  .seg label.on {
    background: var(--accent-soft);
    color: var(--fg-0);
  }
  .seg input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .slider input[type="range"] {
    flex: 1;
  }
  .val {
    width: 28px;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: none;
  }
  .meta {
    margin: 12px 0 0;
    color: var(--fg-2);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
