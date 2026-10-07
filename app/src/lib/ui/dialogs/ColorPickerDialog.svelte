<script lang="ts">
  /**
   * Photoshop's Color Picker: big cube + strip on the left, new/current preview and the
   * H S B / R G B radio fields (the selected field drives the strip), C M Y K readout,
   * hex, "Only Web Colors", Add to Swatches, OK / Cancel. Opened through
   * `openColorPicker()` (`color-picker.ts`) by every swatch control.
   */
  import type { RGBA } from "$lib/engine";
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import ColorCube from "../panels/ColorCube.svelte";
  import { swatchStore } from "../panels/Swatches.store.svelte";
  import { cmykToRgb, hexToRgb, hsbToRgb, isWebSafe, rgbToCmyk, rgbToHex, rgbToHsb, snapWebSafe, type CubeMode, type HSB, type RGB } from "../panels/color-model";

  interface Props {
    initial: RGBA;
    title?: string;
    resolve: Resolver<RGBA>;
  }
  let { initial, title = "Color Picker", resolve }: Props = $props();

  // svelte-ignore state_referenced_locally
  const current: RGB = { r: initial.r, g: initial.g, b: initial.b };
  let color = $state<RGB>({ ...current });
  let hsb = $state<HSB>(rgbToHsb(current));
  let mode = $state<CubeMode>("H");
  let webOnly = $state(false);
  let hexText = $state(rgbToHex(current).slice(1).toUpperCase());
  let hexFocused = $state(false);
  let added = $state(false);

  const cmyk = $derived(rgbToCmyk(color));
  const hex = $derived(rgbToHex(color));

  $effect(() => {
    if (!hexFocused) hexText = hex.slice(1).toUpperCase();
  });

  function setColor(c: RGB, h?: HSB): void {
    const next = webOnly ? snapWebSafe(c) : c;
    color = next;
    if (h && !webOnly) hsb = h;
    else {
      const d = rgbToHsb(next);
      hsb = d.s === 0 ? { ...d, h: (h ?? hsb).h } : d;
    }
    added = false;
  }
  function setHsb(patch: Partial<HSB>): void {
    const h = { ...hsb, ...patch };
    setColor(hsbToRgb(h), h);
  }
  function setRgb(patch: Partial<RGB>): void {
    const c = { ...color, ...patch };
    const h = rgbToHsb(c);
    setColor(c, h.s === 0 || h.b === 0 ? { ...h, h: hsb.h } : h);
  }
  function setCmyk(patch: Partial<typeof cmyk>): void {
    setRgb(cmykToRgb({ ...cmyk, ...patch }));
  }
  function commitHex(): void {
    const c = hexToRgb(hexText);
    if (c) setRgb(c);
    else hexText = hex.slice(1).toUpperCase();
  }
  function toggleWeb(): void {
    webOnly = !webOnly;
    if (webOnly) setColor(color);
  }
  function num(e: Event, min: number, max: number): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return null;
    return Math.max(min, Math.min(max, v));
  }
  function addToSwatches(): void {
    swatchStore.add(color);
    added = true;
  }
  function ok(): void {
    resolve({ r: color.r, g: color.g, b: color.b, a: 255 });
  }
</script>

<Dialog {title} width={560} oncancel={() => resolve(null)} onsubmit={ok}>
  <div class="picker">
    <div class="left">
      <ColorCube {mode} {color} {hsb} size={256} stripWidth={18} onchange={(c, h) => setColor(c, h)} />
      <label class="web">
        <input type="checkbox" checked={webOnly} onchange={toggleWeb} />
        Only Web Colors
      </label>
    </div>

    <div class="right">
      <div class="preview-row">
        <div class="preview">
          <div class="swatch new" style:background={hex}></div>
          <div class="swatch cur" style:background={rgbToHex(current)}></div>
          <span class="cap new-cap">new</span>
          <span class="cap cur-cap">current</span>
          {#if !isWebSafe(color)}
            <button type="button" class="cube-warn" title="Not a web-safe colour. Click to snap to the nearest web-safe colour." onclick={() => setRgb(snapWebSafe(color))}>
              <span class="cube-ico"></span>
              <span class="cube-sw" style:background={rgbToHex(snapWebSafe(color))}></span>
            </button>
          {/if}
        </div>
        <div class="buttons">
          <button type="button" class="btn primary" onclick={ok}>OK</button>
          <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
          <button type="button" class="btn" onclick={addToSwatches} disabled={added}>{added ? "Added" : "Add to Swatches"}</button>
          <button type="button" class="btn" disabled title="Color Libraries are not available">Color Libraries</button>
        </div>
      </div>

      <div class="fields">
        <div class="col">
          <label class="f"><input type="radio" name="cube" checked={mode === "H"} onchange={() => (mode = "H")} /><span class="l">H:</span><input class="input" type="number" min="0" max="360" step="1" value={Math.round(hsb.h)} onchange={(e) => { const v = num(e, 0, 360); if (v !== null) setHsb({ h: v }); }} /><span class="u">°</span></label>
          <label class="f"><input type="radio" name="cube" checked={mode === "S"} onchange={() => (mode = "S")} /><span class="l">S:</span><input class="input" type="number" min="0" max="100" step="1" value={Math.round(hsb.s)} onchange={(e) => { const v = num(e, 0, 100); if (v !== null) setHsb({ s: v }); }} /><span class="u">%</span></label>
          <label class="f"><input type="radio" name="cube" checked={mode === "B"} onchange={() => (mode = "B")} /><span class="l">B:</span><input class="input" type="number" min="0" max="100" step="1" value={Math.round(hsb.b)} onchange={(e) => { const v = num(e, 0, 100); if (v !== null) setHsb({ b: v }); }} /><span class="u">%</span></label>
          <div class="gap"></div>
          <label class="f"><input type="radio" name="cube" checked={mode === "R"} onchange={() => (mode = "R")} /><span class="l">R:</span><input class="input" type="number" min="0" max="255" step="1" value={color.r} onchange={(e) => { const v = num(e, 0, 255); if (v !== null) setRgb({ r: v }); }} /><span class="u"></span></label>
          <label class="f"><input type="radio" name="cube" checked={mode === "G"} onchange={() => (mode = "G")} /><span class="l">G:</span><input class="input" type="number" min="0" max="255" step="1" value={color.g} onchange={(e) => { const v = num(e, 0, 255); if (v !== null) setRgb({ g: v }); }} /><span class="u"></span></label>
          <label class="f"><input type="radio" name="cube" checked={mode === "BL"} onchange={() => (mode = "BL")} /><span class="l">B:</span><input class="input" type="number" min="0" max="255" step="1" value={color.b} onchange={(e) => { const v = num(e, 0, 255); if (v !== null) setRgb({ b: v }); }} /><span class="u"></span></label>
          <div class="gap"></div>
          <label class="f hex"><span class="radio-ph"></span><span class="l">#</span><input class="input" type="text" maxlength="6" spellcheck="false" bind:value={hexText} onfocus={() => (hexFocused = true)} onblur={() => { hexFocused = false; commitHex(); }} onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitHex(); } }} aria-label="Hex" /></label>
        </div>
        <div class="col">
          <label class="f"><span class="radio-ph"></span><span class="l">C:</span><input class="input" type="number" min="0" max="100" value={cmyk.c} onchange={(e) => { const v = num(e, 0, 100); if (v !== null) setCmyk({ c: v }); }} /><span class="u">%</span></label>
          <label class="f"><span class="radio-ph"></span><span class="l">M:</span><input class="input" type="number" min="0" max="100" value={cmyk.m} onchange={(e) => { const v = num(e, 0, 100); if (v !== null) setCmyk({ m: v }); }} /><span class="u">%</span></label>
          <label class="f"><span class="radio-ph"></span><span class="l">Y:</span><input class="input" type="number" min="0" max="100" value={cmyk.y} onchange={(e) => { const v = num(e, 0, 100); if (v !== null) setCmyk({ y: v }); }} /><span class="u">%</span></label>
          <label class="f"><span class="radio-ph"></span><span class="l">K:</span><input class="input" type="number" min="0" max="100" value={cmyk.k} onchange={(e) => { const v = num(e, 0, 100); if (v !== null) setCmyk({ k: v }); }} /><span class="u">%</span></label>
          <div class="note">CMYK is an unmanaged approximation.</div>
        </div>
      </div>
    </div>
  </div>
</Dialog>

<style>
  .picker {
    display: flex;
    gap: 14px;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: none;
  }
  .web {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ps-text);
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .preview-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .preview {
    position: relative;
    display: grid;
    grid-template-columns: 60px auto;
    grid-template-rows: 30px 30px;
    column-gap: 6px;
    align-items: center;
    flex: none;
  }
  .swatch {
    width: 60px;
    height: 30px;
    border: 1px solid var(--ps-border-dark);
  }
  .swatch.new {
    grid-column: 1;
    grid-row: 1;
    border-bottom: 0;
  }
  .swatch.cur {
    grid-column: 1;
    grid-row: 2;
  }
  .cap {
    font-size: var(--fs-xs);
    color: var(--ps-text-dim);
  }
  .new-cap {
    grid-column: 2;
    grid-row: 1;
    align-self: start;
    padding-top: 2px;
  }
  .cur-cap {
    grid-column: 2;
    grid-row: 2;
    align-self: end;
    padding-bottom: 2px;
  }
  .cube-warn {
    position: absolute;
    left: 66px;
    top: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }
  .cube-ico {
    width: 10px;
    height: 10px;
    border: 1px solid var(--ps-text-dim);
    box-shadow: 2px -2px 0 -1px var(--ps-text-dim);
  }
  .cube-sw {
    width: 12px;
    height: 8px;
    border: 1px solid var(--ps-border-dark);
  }
  .buttons {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-left: auto;
  }
  .buttons .btn {
    width: 124px;
  }
  .fields {
    display: flex;
    gap: 18px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .gap {
    height: 6px;
  }
  .f {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 20px;
  }
  .radio-ph {
    width: 12px;
    flex: none;
  }
  .l {
    width: 14px;
    text-align: right;
    color: var(--ps-text);
  }
  .f .input {
    width: 48px;
    text-align: right;
  }
  .f.hex .input {
    width: 68px;
    text-align: left;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }
  .u {
    width: 12px;
    color: var(--ps-text-dim);
  }
  .note {
    margin-top: 6px;
    max-width: 130px;
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
    line-height: 1.3;
  }
</style>
