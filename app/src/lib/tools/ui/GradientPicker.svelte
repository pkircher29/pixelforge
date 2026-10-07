<script lang="ts">
  /** Options-bar gradient picker: the bar opens the Gradient Editor, ▾ opens the preset grid. */
  import Popover from "$lib/ui/controls/Popover.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { openDialog } from "$lib/ui/dialogs/dialogs.svelte";
  import GradientEditorDialog from "$lib/ui/dialogs/GradientEditorDialog.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { DEFAULT_GRADIENTS, loadUserGradients } from "../gradient-presets";
  import { serializeGradient, type GradientDef } from "../gradient-model";
  import { currentGradient } from "../gradient";
  import { drawGradientBar } from "./gradient-draw";

  interface Props {
    value: string;
    onchange: (v: string) => void;
  }
  let { value, onchange }: Props = $props();

  let btn = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let bar = $state<HTMLCanvasElement | null>(null);
  let userVersion = $state(0);
  const def = $derived(currentGradient(value));
  const presets = $derived.by(() => {
    void userVersion;
    return [...DEFAULT_GRADIENTS, ...loadUserGradients()];
  });

  $effect(() => {
    const el = bar;
    if (!el) return;
    drawGradientBar(el, def, toolStore.fg, toolStore.bg);
  });

  function preview(el: HTMLCanvasElement, g: GradientDef) {
    const draw = () => drawGradientBar(el, g, toolStore.fg, toolStore.bg);
    draw();
    return { update: draw };
  }
  function pick(g: GradientDef) {
    open = false;
    onchange(DEFAULT_GRADIENTS.some((d) => d.id === g.id) ? g.id : serializeGradient(g));
  }
  async function edit() {
    const r = await openDialog<{ initial: GradientDef }, GradientDef>(GradientEditorDialog, { initial: def });
    userVersion++;
    if (!r) return;
    // An untouched preset is stored by id; anything edited is stored as its full definition.
    const preset = DEFAULT_GRADIENTS.find((d) => d.id === r.id);
    onchange(preset && serializeGradient(preset) === serializeGradient(r) ? r.id : serializeGradient(r));
  }
</script>

<span class="wrap">
  <button type="button" class="bar" data-tip="Click to edit the gradient" aria-label="Edit gradient" onclick={edit}>
    <canvas bind:this={bar}></canvas>
  </button>
  <button type="button" class="caret" bind:this={btn} aria-label="Gradient presets" onclick={() => (open = !open)}><Icon name="caret-small" size={12} /></button>
  <Popover anchor={btn} open={open} onclose={() => (open = false)} minWidth={260}>
    <div class="pop">
      <div class="grid" role="listbox" aria-label="Gradient presets">
        {#each presets as g (g.id)}
          <button type="button" role="option" class="cell" class:on={g.id === def.id} aria-selected={g.id === def.id} title={g.name} onclick={() => pick(g)}>
            <canvas use:preview={g}></canvas>
          </button>
        {/each}
      </div>
      <div class="foot"><button type="button" class="btn sm" onclick={() => { open = false; void edit(); }}>Gradient Editor…</button></div>
    </div>
  </Popover>
</span>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
    gap: 1px;
  }
  .bar {
    display: block;
    width: 72px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
    background: var(--ps-input);
  }
  .bar canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .caret {
    display: grid;
    place-items: center;
    width: 12px;
    height: 18px;
    color: var(--ps-text-dim);
    border-radius: 2px;
  }
  .caret:hover {
    color: var(--ps-text);
    background: var(--ps-hover);
  }
  .pop {
    width: 268px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }
  .cell {
    height: 26px;
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
    border-color: var(--ps-border-light);
  }
  .cell.on {
    border-color: var(--ps-accent);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
  }
</style>
