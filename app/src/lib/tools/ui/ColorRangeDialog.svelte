<script lang="ts">
  /**
   * Select ▸ Color Range: Select (Sampled / Reds…Shadows), Fuzziness, a grayscale preview
   * of the resulting selection, eyedropper +/− sampling by clicking the preview (Shift
   * adds, Alt subtracts), Invert. Resolves with the selection.
   */
  import Dialog from "$lib/ui/dialogs/Dialog.svelte";
  import type { Resolver } from "$lib/ui/dialogs/dialogs.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { Raster, Selection, type RGBA } from "$lib/engine";
  import { colorRangeSelection, type ColorRangePreset } from "../select-ops";

  interface Props {
    composite: Raster;
    initialColor: RGBA;
    resolve: Resolver<Selection>;
  }
  let { composite, initialColor, resolve }: Props = $props();

  // svelte-ignore state_referenced_locally
  let samples = $state<RGBA[]>([initialColor]);
  let fuzziness = $state(40);
  let invert = $state(false);
  let preset = $state<ColorRangePreset>("sampled");
  let mode = $state<"set" | "add" | "subtract">("set");
  let showImage = $state(false);
  let canvas = $state<HTMLCanvasElement | null>(null);

  // Preview at reduced size for speed.
  // svelte-ignore state_referenced_locally
  const scale = Math.min(1, 220 / Math.max(composite.width, composite.height));
  // svelte-ignore state_referenced_locally
  const small = scale < 1 ? composite.resize(Math.max(1, Math.round(composite.width * scale)), Math.max(1, Math.round(composite.height * scale)), "bilinear") : composite;

  const sel = $derived(colorRangeSelection(small, preset, samples, fuzziness, invert));

  $effect(() => {
    const el = canvas;
    if (!el) return;
    el.width = small.width;
    el.height = small.height;
    const g = el.getContext("2d");
    if (!g) return;
    if (showImage) {
      g.putImageData(small.toImageData(), 0, 0);
      return;
    }
    g.putImageData(sel.toLuminanceMask().toImageData(), 0, 0);
  });

  function pick(e: PointerEvent) {
    if (preset !== "sampled") return;
    const el = canvas!;
    const r = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * small.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * small.height);
    const c = small.getPixel(x, y);
    const col = { r: c.r, g: c.g, b: c.b, a: 255 };
    const m = e.shiftKey ? "add" : e.altKey ? "subtract" : mode;
    if (m === "add") samples = [...samples, col];
    else if (m === "subtract") samples = samples.filter((s) => Math.max(Math.abs(s.r - col.r), Math.abs(s.g - col.g), Math.abs(s.b - col.b)) > fuzziness / 2);
    else samples = [col];
    if (samples.length === 0) samples = [col];
  }

  function ok() {
    resolve(colorRangeSelection(composite, preset, samples, fuzziness, invert));
  }
  const PRESETS: { value: ColorRangePreset; label: string }[] = [
    { value: "sampled", label: "Sampled Colors" },
    { value: "reds", label: "Reds" },
    { value: "yellows", label: "Yellows" },
    { value: "greens", label: "Greens" },
    { value: "cyans", label: "Cyans" },
    { value: "blues", label: "Blues" },
    { value: "magentas", label: "Magentas" },
    { value: "highlights", label: "Highlights" },
    { value: "midtones", label: "Midtones" },
    { value: "shadows", label: "Shadows" },
  ];
</script>

<Dialog title="Color Range" width={470} oncancel={() => resolve(null)} onsubmit={ok}>
  <div class="layout">
    <div class="left">
      <label class="row"><span class="lab">Select:</span>
        <select class="input" bind:value={preset}>
          {#each PRESETS as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
        </select>
      </label>
      <label class="row"><span class="lab">Fuzziness:</span>
        <input type="range" min="0" max="200" bind:value={fuzziness} disabled={preset !== "sampled"} />
        <input class="input num" type="number" min="0" max="200" bind:value={fuzziness} disabled={preset !== "sampled"} />
      </label>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="pv" onpointerdown={pick} title="Click to sample a color (Shift adds, Alt subtracts)">
        <canvas bind:this={canvas}></canvas>
      </div>
      <div class="row">
        <label class="chk"><input type="radio" name="crv" checked={!showImage} onchange={() => (showImage = false)} /> Selection</label>
        <label class="chk"><input type="radio" name="crv" checked={showImage} onchange={() => (showImage = true)} /> Image</label>
      </div>
    </div>
    <div class="right">
      <button type="button" class="btn primary" onclick={ok}>OK</button>
      <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
      <div class="drops" role="radiogroup" aria-label="Sampling mode">
        <button type="button" class="icon-btn" class:on={mode === "set"} aria-label="Eyedropper" data-tip="Eyedropper" onclick={() => (mode = "set")}><Icon name="eyedropper" size={16} /></button>
        <button type="button" class="icon-btn" class:on={mode === "add"} aria-label="Add to sample" data-tip="Add to Sample" onclick={() => (mode = "add")}><Icon name="plus" size={16} /></button>
        <button type="button" class="icon-btn" class:on={mode === "subtract"} aria-label="Subtract from sample" data-tip="Subtract from Sample" onclick={() => (mode = "subtract")}><Icon name="minus" size={16} /></button>
      </div>
      <label class="chk"><input type="checkbox" bind:checked={invert} /> Invert</label>
      <div class="sw">
        {#each samples.slice(0, 8) as s, i (i)}<span class="dot" style:background="rgb({s.r},{s.g},{s.b})"></span>{/each}
      </div>
    </div>
  </div>
</Dialog>

<style>
  .layout {
    display: flex;
    gap: 14px;
  }
  .left {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .right {
    width: 88px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .right .btn {
    width: 100%;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row input[type="range"] {
    flex: 1;
  }
  .lab {
    color: var(--ps-text-dim);
    width: 62px;
  }
  .num {
    width: 48px;
  }
  .pv {
    display: grid;
    place-items: center;
    height: 230px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    cursor: crosshair;
  }
  .pv canvas {
    max-width: 220px;
    max-height: 220px;
    image-rendering: auto;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .drops {
    display: flex;
    gap: 2px;
    margin-top: 10px;
  }
  .sw {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border: 1px solid var(--ps-border-dark);
  }
</style>
