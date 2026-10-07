<script lang="ts">
  /**
   * Character panel (PS): font family / style, size, leading, tracking, color, faux
   * bold / italic, All Caps. Bound to the live type session, else the active text layer,
   * else the Type tool defaults. Underline / small caps / baseline shift need engine
   * TextSpec support and are shown disabled.
   */
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import FontPicker from "$lib/tools/ui/FontPicker.svelte";
  import { rgbaToHex, hexToRgba } from "$lib/stores/tool.svelte";
  import { applyTypePatch, currentTypeTarget } from "$lib/tools/ui/type-target.svelte";

  const t = $derived(currentTypeTarget());
  const s = $derived(t.spec);
  const style = $derived(s.bold && s.italic ? "boldItalic" : s.bold ? "bold" : s.italic ? "italic" : "regular");
  const STYLES = [
    { value: "regular", label: "Regular" },
    { value: "bold", label: "Bold" },
    { value: "italic", label: "Italic" },
    { value: "boldItalic", label: "Bold Italic" },
  ];
  const allCaps = $derived(s.text.length > 0 && s.text === s.text.toUpperCase() && /[A-Z]/.test(s.text));
  function setStyle(v: string) {
    applyTypePatch({ bold: v === "bold" || v === "boldItalic", italic: v === "italic" || v === "boldItalic" });
  }
  function toggleCaps() {
    if (!s.text) return;
    applyTypePatch({ text: allCaps ? s.text.toLowerCase() : s.text.toUpperCase() });
  }
</script>

<div class="cp">
  {#if t.kind === "defaults"}
    <p class="hint">Settings for new type. Select a text layer to edit it.</p>
  {/if}
  <div class="row"><FontPicker value={s.font} width={236} onchange={(v) => applyTypePatch({ font: v })} /></div>
  <div class="row"><PsSelect value={style} choices={STYLES} width={236} onchange={setStyle} /></div>
  <div class="grid">
    <ScrubbyNumber label="Size" value={s.size} min={1} max={1296} log unit="pt" width={44} onchange={(v) => applyTypePatch({ size: v })} />
    <ScrubbyNumber label="Leading" value={s.leading ?? Math.round(s.size * 1.2)} min={1} max={5000} unit="pt" width={44} onchange={(v) => applyTypePatch({ leading: v })} />
    <ScrubbyNumber label="Tracking" value={s.tracking} min={-1000} max={10000} width={44} onchange={(v) => applyTypePatch({ tracking: v })} />
    <button type="button" class="btn sm auto" disabled={s.leading === null} onclick={() => applyTypePatch({ leading: null })} title="Auto leading (120 %)">Auto</button>
  </div>
  <div class="row">
    <span class="lbl">Color:</span>
    <span class="swatch" style:background={rgbaToHex(s.color)}>
      <input type="color" value={rgbaToHex(s.color)} aria-label="Text color" oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) applyTypePatch({ color: c }); }} />
    </span>
  </div>
  <div class="toggles" role="group" aria-label="Type style">
    <button type="button" class="tg" class:on={s.bold} title="Faux Bold" aria-pressed={s.bold} onclick={() => applyTypePatch({ bold: !s.bold })}><b>T</b></button>
    <button type="button" class="tg" class:on={s.italic} title="Faux Italic" aria-pressed={s.italic} onclick={() => applyTypePatch({ italic: !s.italic })}><i>T</i></button>
    <button type="button" class="tg" class:on={allCaps} title="All Caps" aria-pressed={allCaps} disabled={!s.text} onclick={toggleCaps}>TT</button>
    <button type="button" class="tg" disabled title="Small Caps (not supported yet)">Tt</button>
    <button type="button" class="tg" disabled title="Underline (not supported yet)"><u>T</u></button>
    <button type="button" class="tg" disabled title="Strikethrough (not supported yet)"><s>T</s></button>
  </div>
  <div class="row">
    <span class="lbl">Anti-aliasing:</span>
    <PsSelect value={s.antialias ? "smooth" : "none"} choices={[{ value: "none", label: "None" }, { value: "smooth", label: "Smooth" }]} onchange={(v) => applyTypePatch({ antialias: v !== "none" })} />
  </div>
</div>

<style>
  .cp {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px;
    font-size: var(--fs-sm);
  }
  .hint {
    margin: 0;
    color: var(--ps-text-dim);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 10px;
    align-items: center;
  }
  .auto {
    justify-self: start;
  }
  .lbl {
    color: var(--ps-text-dim);
  }
  .swatch {
    position: relative;
    width: 40px;
    height: 16px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
  }
  .toggles {
    display: flex;
    gap: 1px;
  }
  .tg {
    width: 26px;
    height: 20px;
    border-radius: 2px;
    color: var(--ps-text-dim);
    font-family: Georgia, serif;
  }
  .tg:hover:not(:disabled) {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .tg.on {
    background: var(--ps-active);
    color: var(--ps-text);
    box-shadow: inset 0 0 0 1px var(--ps-border-dark);
  }
  .tg:disabled {
    opacity: 0.35;
  }
</style>
