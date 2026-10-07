<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { MAX_CANVAS_SIZE, type RGBA } from "$lib/engine";
  import { hexToRgba } from "$lib/stores/tool.svelte";

  export interface NewDocResult {
    name: string;
    width: number;
    height: number;
    background: "transparent" | "white" | RGBA;
    dpi: number;
  }

  interface Props {
    defaultName: string;
    resolve: Resolver<NewDocResult>;
  }
  let { defaultName, resolve }: Props = $props();

  const presets = [
    { id: "hd", label: "HD 1920 × 1080", w: 1920, h: 1080, dpi: 72 },
    { id: "square", label: "Square 1080 × 1080", w: 1080, h: 1080, dpi: 72 },
    { id: "4k", label: "4K 3840 × 2160", w: 3840, h: 2160, dpi: 72 },
    { id: "a4", label: "A4 @ 300 dpi", w: 2480, h: 3508, dpi: 300 },
    { id: "custom", label: "Custom", w: 0, h: 0, dpi: 72 },
  ];

  // svelte-ignore state_referenced_locally
  let name = $state(defaultName);
  let preset = $state("hd");
  let width = $state(1920);
  let height = $state(1080);
  let dpi = $state(72);
  let bg = $state<"transparent" | "white" | "color">("white");
  let color = $state("#1a1e27");

  function pick(id: string) {
    preset = id;
    const p = presets.find((x) => x.id === id);
    if (p && p.w > 0) {
      width = p.w;
      height = p.h;
      dpi = p.dpi;
    }
  }

  function onSize() {
    preset = "custom";
  }

  const valid = $derived(
    Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= MAX_CANVAS_SIZE && height <= MAX_CANVAS_SIZE,
  );
  const megapixels = $derived(((width * height) / 1e6).toFixed(1));

  function submit() {
    if (!valid) return;
    const background = bg === "color" ? (hexToRgba(color) ?? "white") : bg;
    resolve({ name: name.trim() || defaultName, width, height, background, dpi });
  }
</script>

<Dialog title="New document" width={460} oncancel={() => resolve(null)} onsubmit={submit}>
  <div class="grid">
    <label class="row">
      <span>Name</span>
      <input class="input" type="text" bind:value={name} data-autofocus />
    </label>
    <label class="row">
      <span>Preset</span>
      <select class="select" value={preset} onchange={(e) => pick(e.currentTarget.value)}>
        {#each presets as p (p.id)}
          <option value={p.id}>{p.label}</option>
        {/each}
      </select>
    </label>
    <div class="row">
      <span>Size</span>
      <span class="dims">
        <input class="input num" type="number" min="1" max={MAX_CANVAS_SIZE} bind:value={width} oninput={onSize} aria-label="Width" />
        <span class="x">×</span>
        <input class="input num" type="number" min="1" max={MAX_CANVAS_SIZE} bind:value={height} oninput={onSize} aria-label="Height" />
        <span class="unit">px</span>
      </span>
    </div>
    <label class="row">
      <span>Resolution</span>
      <span class="dims">
        <input class="input num" type="number" min="1" max="2400" bind:value={dpi} />
        <span class="unit">dpi</span>
      </span>
    </label>
    <div class="row">
      <span>Background</span>
      <span class="choices" role="radiogroup">
        <label class="chip" class:on={bg === "white"}><input type="radio" bind:group={bg} value="white" /> White</label>
        <label class="chip" class:on={bg === "transparent"}><input type="radio" bind:group={bg} value="transparent" /> Transparent</label>
        <label class="chip" class:on={bg === "color"}>
          <input type="radio" bind:group={bg} value="color" /> Color
          <input type="color" class="swatch" bind:value={color} aria-label="Background color" />
        </label>
      </span>
    </div>
  </div>
  <p class="meta">
    {#if valid}
      {megapixels} MP · {(width * height * 4 / 1048576).toFixed(1)} MB per layer
    {:else}
      Each side must be 1 – {MAX_CANVAS_SIZE} px.
    {/if}
  </p>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" disabled={!valid} onclick={submit}>Create</button>
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
  .dims {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 86px;
  }
  .x,
  .unit {
    color: var(--fg-2);
  }
  .choices {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    color: var(--fg-1);
    transition: background var(--t-fast) ease-out, color var(--t-fast) ease-out, border-color var(--t-fast) ease-out;
  }
  .chip input[type="radio"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .chip.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--fg-0);
  }
  .swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: none;
  }
  .meta {
    margin: 12px 0 0;
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-xs);
  }
</style>
