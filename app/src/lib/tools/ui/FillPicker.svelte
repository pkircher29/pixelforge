<script lang="ts">
  /**
   * Shape Fill / Stroke picker (PS): a swatch showing none / solid / gradient; the popover
   * switches between the three and offers a colour input or the gradient presets + editor.
   */
  import Popover from "$lib/ui/controls/Popover.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { openDialog } from "$lib/ui/dialogs/dialogs.svelte";
  import GradientEditorDialog from "$lib/ui/dialogs/GradientEditorDialog.svelte";
  import { toolStore, rgbaToHex, hexToRgba } from "$lib/stores/tool.svelte";
  import type { GradientFill, SolidFill } from "$lib/engine";
  import { parseFill } from "../shapes";
  import { DEFAULT_GRADIENTS, loadUserGradients } from "../gradient-presets";
  import { toEngineGradient, type GradientDef } from "../gradient-model";
  import { drawGradientBar } from "./gradient-draw";

  interface Props {
    label: string;
    value: string;
    allowNone: boolean;
    onchange: (v: string) => void;
  }
  let { label, value, allowNone, onchange }: Props = $props();
  let btn = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  const fill = $derived(parseFill(value));
  const mode = $derived<"none" | "solid" | "gradient">(fill ? fill.type : "none");
  let lastDef = $state<GradientDef>(DEFAULT_GRADIENTS[2]!);
  const presets = $derived([...DEFAULT_GRADIENTS, ...loadUserGradients()]);
  const RECENT = ["#000000", "#ffffff", "#e34850", "#f29423", "#f5d327", "#2d9d78", "#1473e6", "#9256d9", "#6b6b6b"];

  function gradientFill(def: GradientDef): GradientFill {
    return { type: "gradient", gradient: toEngineGradient(def, toolStore.fg, toolStore.bg), style: "linear", angle: 90, scale: 1, reverse: false, offset: { x: 0, y: 0 } };
  }
  function setSolid(hex: string) {
    const c = hexToRgba(hex);
    if (!c) return;
    const f: SolidFill = { type: "solid", color: c };
    onchange(JSON.stringify(f));
  }
  function setGradient(def: GradientDef) {
    lastDef = def;
    onchange(JSON.stringify(gradientFill(def)));
  }
  async function edit() {
    const r = await openDialog<{ initial: GradientDef }, GradientDef>(GradientEditorDialog, { initial: lastDef });
    if (r) setGradient(r);
  }
  function preview(el: HTMLCanvasElement, g: GradientDef) {
    const draw = () => drawGradientBar(el, g, toolStore.fg, toolStore.bg);
    draw();
    return { update: draw };
  }
  function swatchStyle(): string {
    if (!fill) return "";
    if (fill.type === "solid") return `background:${rgbaToHex(fill.color)}`;
    const stops = fill.gradient.stops.map((s) => `rgba(${Math.round(s.color.r)},${Math.round(s.color.g)},${Math.round(s.color.b)},${s.color.a / 255}) ${Math.round(s.pos * 100)}%`).join(",");
    return `background:linear-gradient(90deg,${stops})`;
  }
</script>

<span class="wrap">
  {#if label}<span class="lbl">{label}:</span>{/if}
  <button type="button" class="sw" class:none={!fill} bind:this={btn} style={swatchStyle()} aria-label="{label} picker" onclick={() => (open = !open)}></button>
  <Popover anchor={btn} open={open} onclose={() => (open = false)} minWidth={230}>
    <div class="pop">
      <div class="modes">
        {#if allowNone}<button type="button" class="m none" class:on={mode === "none"} title="No {label.toLowerCase()}" aria-label="None" onclick={() => onchange("null")}></button>{/if}
        <button type="button" class="m" class:on={mode === "solid"} title="Solid Color" aria-label="Solid Color" onclick={() => setSolid(fill?.type === "solid" ? rgbaToHex(fill.color) : rgbaToHex(toolStore.fg))}><span class="solid"></span></button>
        <button type="button" class="m" class:on={mode === "gradient"} title="Gradient" aria-label="Gradient" onclick={() => setGradient(lastDef)}><span class="grad"></span></button>
      </div>
      {#if mode === "solid" && fill?.type === "solid"}
        <div class="recent">
          {#each RECENT as hex (hex)}
            <button type="button" class="chip" style:background={hex} aria-label={hex} onclick={() => setSolid(hex)}></button>
          {/each}
          <label class="chip picker" style:background={rgbaToHex(fill.color)} title="Pick a colour">
            <input type="color" value={rgbaToHex(fill.color)} oninput={(e) => setSolid(e.currentTarget.value)} aria-label="Colour" />
            <Icon name="color" size={12} />
          </label>
        </div>
      {:else if mode === "gradient"}
        <div class="grid">
          {#each presets as g (g.id)}
            <button type="button" class="cell" title={g.name} onclick={() => setGradient(g)}><canvas use:preview={g}></canvas></button>
          {/each}
        </div>
        <div class="foot"><button type="button" class="btn sm" onclick={() => { open = false; void edit(); }}>Edit gradient…</button></div>
      {:else}
        <div class="hint">No {label.toLowerCase()}.</div>
      {/if}
    </div>
  </Popover>
</span>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .lbl {
    color: var(--ps-text-dim);
  }
  .sw {
    width: 28px;
    height: 18px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
    background: var(--ps-input);
  }
  .sw.none {
    background: linear-gradient(to top right, transparent 46%, #e34850 46%, #e34850 54%, transparent 54%), #fff;
  }
  .pop {
    width: 240px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .modes {
    display: flex;
    gap: 3px;
  }
  .m {
    width: 24px;
    height: 20px;
    border: 1px solid var(--ps-border-dark);
    border-radius: 2px;
    background: var(--ps-input);
    display: grid;
    place-items: center;
  }
  .m.on {
    border-color: var(--ps-accent);
    background: var(--ps-active);
  }
  .m.none {
    background: linear-gradient(to top right, var(--ps-input) 46%, #e34850 46%, #e34850 54%, var(--ps-input) 54%);
  }
  .solid {
    width: 14px;
    height: 10px;
    background: var(--ps-text);
  }
  .grad {
    width: 14px;
    height: 10px;
    background: linear-gradient(90deg, #000, #fff);
  }
  .recent {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .chip {
    position: relative;
    width: 18px;
    height: 18px;
    border: 1px solid var(--ps-border-dark);
    display: grid;
    place-items: center;
    color: #fff;
    mix-blend-mode: normal;
  }
  .chip input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 3px;
  }
  .cell {
    height: 22px;
    padding: 1px;
    border: 1px solid var(--ps-border-dark);
    background: var(--ps-input);
  }
  .cell canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .cell:hover {
    border-color: var(--ps-accent);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
  }
  .hint {
    color: var(--ps-text-dim);
  }
</style>
