<script lang="ts">
  /**
   * Fill-layer content dialogs: "Color Picker (Solid Color)", "Gradient Fill" and
   * "Pattern Fill" — the PS dialogs that follow New Fill Layer ▸ … and double-clicking
   * a fill layer's thumbnail. Live preview on the layer when `layerId` is given.
   */
  import { onDestroy } from "svelte";
  import { Raster, cloneFill, invalidateFillLayer, type FillSpec, type GradientFill, type GradientStyle, type PatternFill, type RGBA, type SolidFill } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import Dialog from "./Dialog.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import LayerStyleAngleDial from "./LayerStyleAngleDial.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { rgbaToHex, hexToRgba } from "./layer-style-model";

  interface Props {
    fill: FillSpec;
    /** Layer to preview on (its `fill` is swapped live and restored on cancel). */
    layerId?: string | null;
    resolve: Resolver<FillSpec>;
  }
  let { fill: initial, layerId = null, resolve }: Props = $props();

  // svelte-ignore state_referenced_locally
  const layer = layerId ? (docStore.doc?.layers.find((l) => l.id === layerId) ?? null) : null;
  const original = layer && layer.kind === "fill" ? layer.fill : null;
  // svelte-ignore state_referenced_locally
  let fill = $state<FillSpec>(cloneFill(initial));
  let closed = false;

  const title = $derived(fill.type === "solid" ? "Color Picker (Solid Color)" : fill.type === "gradient" ? "Gradient Fill" : "Pattern Fill");
  const STYLES = ["linear", "radial", "angle", "reflected", "diamond"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));

  /** Three procedural PS-like patterns. */
  const PATTERNS: { id: string; label: string; make: () => Raster }[] = [
    { id: "checker", label: "Checker", make: () => tile(8, (x, y) => ((x >> 2) + (y >> 2)) % 2 === 0) },
    { id: "diag", label: "Diagonal Lines", make: () => tile(8, (x, y) => (x + y) % 8 < 2) },
    { id: "dots", label: "Dots", make: () => tile(8, (x, y) => Math.hypot(x - 3.5, y - 3.5) < 2.2) },
    { id: "grid", label: "Grid", make: () => tile(12, (x, y) => x === 0 || y === 0) },
  ];
  function tile(size: number, on: (x: number, y: number) => boolean): Raster {
    const r = new Raster(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) r.setPixel(x, y, on(x, y) ? { r: 40, g: 40, b: 40, a: 255 } : { r: 230, g: 230, b: 230, a: 255 });
    return r;
  }
  let patternId = $state("checker");

  function live(): void {
    if (!layer || layer.kind !== "fill" || closed) return;
    layer.fill = cloneFill($state.snapshot(fill) as FillSpec);
    invalidateFillLayer(layer);
    docStore.touch();
  }
  function restore(): void {
    if (!layer || layer.kind !== "fill" || !original) return;
    layer.fill = original;
    invalidateFillLayer(layer);
  }
  onDestroy(() => {
    if (!closed) restore();
  });

  function setSolid(c: RGBA) {
    (fill as SolidFill).color = c;
    live();
  }
  function g(): GradientFill {
    return fill as GradientFill;
  }
  function setStops(a: RGBA, b: RGBA) {
    g().gradient = { stops: [{ pos: 0, color: a }, { pos: 1, color: b }] };
    live();
  }
  function setPattern(id: string) {
    patternId = id;
    const p = PATTERNS.find((x) => x.id === id);
    if (p) {
      (fill as PatternFill).pattern = p.make();
      live();
    }
  }
  function ok() {
    if (closed) return;
    closed = true;
    restore();
    resolve(cloneFill($state.snapshot(fill) as FillSpec));
  }
  function cancel() {
    if (closed) return;
    closed = true;
    restore();
    docStore.touch();
    resolve(null);
  }
  live();
</script>

<Dialog {title} width={380} oncancel={cancel} onsubmit={ok} dim={false}>
  {#if fill.type === "solid"}
    <div class="row"><span>Color:</span><span class="inline"><input type="color" class="swatch big" value={rgbaToHex(fill.color)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) setSolid(c); }} aria-label="Color" data-autofocus /><input class="input hex" type="text" value={rgbaToHex(fill.color).slice(1)} onchange={(e) => { const c = hexToRgba(`#${e.currentTarget.value}`); if (c) setSolid(c); }} aria-label="Hex" /></span></div>
  {:else if fill.type === "gradient"}
    {@const first = fill.gradient.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 255 }}
    {@const last = fill.gradient.stops[fill.gradient.stops.length - 1]?.color ?? { r: 255, g: 255, b: 255, a: 255 }}
    <div class="grid">
      <div class="row">
        <span>Gradient:</span>
        <span class="inline">
          <input type="color" class="swatch" value={rgbaToHex(first)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) setStops(c, last); }} aria-label="Start color" />
          <span class="gbar" style:background="linear-gradient(90deg, {rgbaToHex(first)}, {rgbaToHex(last)})"></span>
          <input type="color" class="swatch" value={rgbaToHex(last)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) setStops(first, c); }} aria-label="End color" />
        </span>
      </div>
      <div class="row"><span>Style:</span><PsSelect value={fill.style} choices={STYLES} width={110} onchange={(v) => { g().style = v as GradientStyle; live(); }} /></div>
      <div class="row"><span>Angle:</span><span class="inline"><LayerStyleAngleDial value={fill.angle} size={32} onchange={(a) => { g().angle = a; live(); }} /><input class="input num" type="number" min="-180" max="180" value={fill.angle} onchange={(e) => { g().angle = Number(e.currentTarget.value); live(); }} aria-label="Angle" /> °</span></div>
      <div class="row"><span>Scale:</span><span class="inline"><input type="range" min="10" max="150" value={Math.round(fill.scale * 100)} oninput={(e) => { g().scale = Number(e.currentTarget.value) / 100; live(); }} aria-label="Scale" /><span class="val">{Math.round(fill.scale * 100)} %</span></span></div>
      <div class="row"><span></span><label class="chk"><input type="checkbox" checked={fill.reverse} onchange={(e) => { g().reverse = e.currentTarget.checked; live(); }} /> Reverse</label></div>
    </div>
  {:else}
    <div class="grid">
      <div class="row"><span>Pattern:</span><PsSelect value={patternId} choices={PATTERNS.map((p) => ({ value: p.id, label: p.label }))} width={130} onchange={setPattern} /></div>
      <div class="row"><span>Scale:</span><span class="inline"><input type="range" min="25" max="400" value={Math.round(fill.scale * 100)} oninput={(e) => { (fill as PatternFill).scale = Number(e.currentTarget.value) / 100; live(); }} aria-label="Scale" /><span class="val">{Math.round(fill.scale * 100)} %</span></span></div>
    </div>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={ok}>OK</button>
    <button type="button" class="btn" onclick={cancel}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: center;
    gap: 8px;
  }
  .row > span:first-child {
    text-align: right;
    color: var(--ps-text-dim);
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    width: 40px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--ps-border-dark);
    background: none;
  }
  .swatch.big {
    width: 64px;
    height: 40px;
  }
  .hex {
    width: 70px;
    font-family: var(--font-mono);
  }
  .gbar {
    display: inline-block;
    width: 140px;
    height: 16px;
    border: 1px solid var(--ps-border-dark);
  }
  .num {
    width: 54px;
  }
  .val {
    min-width: 42px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
</style>
