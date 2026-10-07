<script lang="ts">
  /**
   * Color panel (PS CC): fg/bg swatch pair at the top-left, then either the Hue Cube /
   * Brightness Cube (square + strip) or a slider mode (Grayscale, RGB, HSB) with the
   * spectrum ramp along the bottom. Click a swatch to target it; click the targeted
   * swatch again to open the Color Picker. Mode lives in `colorPanelUi` for the ≡ menu.
   */
  import { toolStore } from "$lib/stores/tool.svelte";
  import type { RGBA } from "$lib/engine";
  import { openColorPicker } from "../dialogs/color-picker";
  import ColorCube from "./ColorCube.svelte";
  import { colorPanelUi } from "./Color.store.svelte";
  import { grayKToRgb, hexToRgb, hsbSliderGradient, hsbToRgb, rampColor, rgbEquals, rgbSliderGradient, rgbToGrayK, rgbToHex, rgbToHsb, type HSB, type RGB } from "./color-model";

  let target = $state<"fg" | "bg">("fg");
  // Hue/sat memory: a pure black fg would otherwise snap the hue to 0.
  let hsb = $state<HSB>(rgbToHsb(toolStore.fg));
  let lastRgb = $state<RGB>({ ...toolStore.fg });
  let hexText = $state("");
  let hexFocused = $state(false);
  let ramp = $state<HTMLCanvasElement | null>(null);

  const color = $derived<RGB>(target === "fg" ? toolStore.fg : toolStore.bg);
  const hex = $derived(rgbToHex(color));
  const mode = $derived(colorPanelUi.mode);

  // External color changes (eyedropper, X, D…) re-derive HSB; our own writes keep it.
  $effect(() => {
    const c = color;
    if (rgbEquals(c, lastRgb)) return;
    lastRgb = { ...c };
    const h = rgbToHsb(c);
    hsb = h.s === 0 ? { ...h, h: hsb.h } : h;
  });
  $effect(() => {
    if (!hexFocused) hexText = hex.slice(1).toUpperCase();
  });
  $effect(() => {
    const el = ramp;
    if (!el || mode === "cube" || mode === "bcube") return;
    const w = 256;
    el.width = w;
    el.height = 1;
    const g = el.getContext("2d");
    if (!g) return;
    const img = g.createImageData(w, 1);
    for (let x = 0; x < w; x++) {
      const c = mode === "gray" ? grayKToRgb((x / (w - 1)) * 100) : rampColor(x / (w - 1));
      img.data[x * 4] = c.r;
      img.data[x * 4 + 1] = c.g;
      img.data[x * 4 + 2] = c.b;
      img.data[x * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });

  function write(c: RGB, h?: HSB): void {
    lastRgb = { ...c };
    if (h) hsb = h;
    const rgba: RGBA = { r: c.r, g: c.g, b: c.b, a: 255 };
    if (target === "fg") toolStore.setFg(rgba);
    else toolStore.setBg(rgba);
  }
  function setHsb(patch: Partial<HSB>): void {
    const h = { ...hsb, ...patch };
    write(hsbToRgb(h), h);
  }
  function setRgb(patch: Partial<RGB>): void {
    const c = { ...color, ...patch };
    const h = rgbToHsb(c);
    write(c, h.s === 0 ? { ...h, h: hsb.h } : h);
  }
  function commitHex(): void {
    const c = hexToRgb(hexText);
    if (c) setRgb(c);
    else hexText = hex.slice(1).toUpperCase();
  }
  async function clickSwatch(which: "fg" | "bg"): Promise<void> {
    if (target !== which) {
      target = which;
      return;
    }
    const r = await openColorPicker(which === "fg" ? toolStore.fg : toolStore.bg, { title: which === "fg" ? "Color Picker (Foreground Color)" : "Color Picker (Background Color)" });
    if (r) write(r);
  }
  function pickRamp(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const pick = (ev: PointerEvent): void => {
      const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
      const c = mode === "gray" ? grayKToRgb(t * 100) : rampColor(t);
      const h = rgbToHsb(c);
      // Alt-click / right button sets the background (PS).
      const prev = target;
      if (ev.altKey || ev.button === 2) target = "bg";
      write(c, h.s === 0 ? { ...h, h: hsb.h } : h);
      target = prev;
    };
    el.setPointerCapture(e.pointerId);
    pick(e);
    const move = (ev: PointerEvent): void => pick(ev);
    const up = (): void => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    e.preventDefault();
  }
  function sliderNum(e: Event, max: number): number {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
  }

  type Row = { key: string; label: string; value: number; max: number; unit: string; track: string; set: (v: number) => void };
  const rows = $derived.by((): Row[] => {
    if (mode === "rgb") {
      return (["r", "g", "b"] as const).map((k) => ({ key: k, label: k.toUpperCase(), value: color[k], max: 255, unit: "", track: rgbSliderGradient(color, k), set: (v) => setRgb({ [k]: Math.round(v) }) }));
    }
    if (mode === "hsb") {
      return (["h", "s", "b"] as const).map((k) => ({ key: k, label: k.toUpperCase(), value: Math.round(hsb[k]), max: k === "h" ? 360 : 100, unit: k === "h" ? "°" : "%", track: hsbSliderGradient(hsb, k), set: (v) => setHsb({ [k]: v }) }));
    }
    if (mode === "gray") {
      return [{ key: "k", label: "K", value: rgbToGrayK(color), max: 100, unit: "%", track: "linear-gradient(to right, #fff, #000)", set: (v) => setRgb(grayKToRgb(v)) }];
    }
    return [];
  });
</script>

<div class="color" class:cubes={mode === "cube" || mode === "bcube"}>
  <div class="swatches">
    <button type="button" class="sw bg" class:on={target === "bg"} style:background={rgbToHex(toolStore.bg)} aria-label="Background color" title="Background Color" onclick={() => void clickSwatch("bg")}></button>
    <button type="button" class="sw fg" class:on={target === "fg"} style:background={rgbToHex(toolStore.fg)} aria-label="Foreground color" title="Foreground Color" onclick={() => void clickSwatch("fg")}></button>
  </div>

  {#if mode === "cube" || mode === "bcube"}
    <div class="cubewrap">
      <ColorCube mode={mode === "cube" ? "H" : "B"} {color} {hsb} fluid stripWidth={14} onchange={(c, h) => write(c, h)} />
    </div>
  {:else}
    <div class="sliders">
      {#each rows as row (row.key)}
        <div class="srow">
          <span class="lbl">{row.label}</span>
          <input type="range" class="track" min="0" max={row.max} step="1" value={row.value} style:--track={row.track} oninput={(e) => row.set(sliderNum(e, row.max))} aria-label={row.label} />
          <input class="input num" type="number" min="0" max={row.max} value={row.value} onchange={(e) => row.set(sliderNum(e, row.max))} aria-label="{row.label} value" />
          <span class="unit">{row.unit}</span>
        </div>
      {/each}
      {#if mode !== "gray"}
        <div class="hexrow">
          <span class="lbl">#</span>
          <input class="input hex" type="text" maxlength="6" spellcheck="false" bind:value={hexText} onfocus={() => (hexFocused = true)} onblur={() => { hexFocused = false; commitHex(); }} onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitHex(); }} aria-label="Hex" />
        </div>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ramp" onpointerdown={pickRamp} oncontextmenu={(e) => e.preventDefault()} title="Click to pick (Alt-click sets the background)">
      <canvas bind:this={ramp} aria-hidden="true"></canvas>
    </div>
  {/if}
</div>

<style>
  .color {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 120px;
    padding: 8px 8px 8px;
  }
  .color.cubes {
    flex-direction: row;
    align-items: stretch;
  }
  .swatches {
    position: relative;
    width: 34px;
    height: 34px;
    flex: none;
  }
  .cubes .swatches {
    margin-top: 0;
  }
  .sw {
    position: absolute;
    width: 22px;
    height: 22px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  }
  .sw.fg {
    left: 0;
    top: 0;
    z-index: 1;
  }
  .sw.bg {
    right: 0;
    bottom: 0;
  }
  .sw.on {
    outline: 1px solid var(--ps-text);
    outline-offset: 1px;
  }
  .cubewrap {
    flex: 1;
    min-width: 0;
    min-height: 100px;
    display: flex;
  }
  .sliders {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }
  .srow,
  .hexrow {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--row-h);
  }
  .lbl {
    width: 12px;
    color: var(--ps-text);
    text-align: center;
  }
  .track {
    flex: 1;
    min-width: 0;
    height: 12px;
  }
  .track::-webkit-slider-runnable-track {
    height: 8px;
    background: var(--track);
    border: 1px solid var(--ps-border-dark);
    box-shadow: none;
  }
  .track::-webkit-slider-thumb {
    width: 0;
    height: 0;
    margin-top: 6px;
    border: 5px solid transparent;
    border-bottom: 6px solid var(--ps-text);
    border-top: 0;
    background: none;
    border-radius: 0;
  }
  .num {
    width: 40px;
  }
  .unit {
    width: 10px;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .hex {
    width: 72px;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }
  .ramp {
    flex: none;
    height: 14px;
    border: 1px solid var(--ps-border-dark);
    cursor: crosshair;
    touch-action: none;
  }
  .ramp canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
