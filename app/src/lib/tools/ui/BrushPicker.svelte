<script lang="ts">
  /**
   * Options-bar Brush Preset picker (PS): tip thumbnail + size, ▾ opens a popover with the
   * live stroke preview, Size / Hardness sliders and the preset grid.
   */
  import Popover from "$lib/ui/controls/Popover.svelte";
  import ScrubbyNumber from "$lib/ui/controls/ScrubbyNumber.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { brushStore } from "../brush-store.svelte";
  import { drawStrokePreview, drawTipPreview } from "./brush-thumb";
  import { canvasHost } from "$lib/ui/canvas/host.svelte";

  let btn = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let face = $state<HTMLCanvasElement | null>(null);
  let strip = $state<HTMLCanvasElement | null>(null);
  const roundTip = $derived(brushStore.settings.tip === "round");

  $effect(() => {
    void brushStore.version;
    const el = face;
    if (!el) return;
    drawTipPreview(el, brushStore.settings, { color: "#e6e6e6" });
  });
  $effect(() => {
    void brushStore.version;
    const el = strip;
    if (!el || !open) return;
    drawStrokePreview(el, brushStore.settings, { color: "#e6e6e6" });
  });

  function thumb(el: HTMLCanvasElement, settings: Parameters<typeof drawStrokePreview>[1]) {
    const draw = () => drawStrokePreview(el, settings, { color: "#e6e6e6" });
    draw();
    return { update: draw };
  }
  function pick(id: string) {
    brushStore.applyPreset(id);
    canvasHost.invalidateOverlay();
  }
  function openPanel() {
    open = false;
    ui.activateTab("brush-settings");
    if (!ui.isPanelVisible("brush-settings")) ui.togglePanel("brush-settings");
  }
</script>

<span class="wrap">
  <button type="button" class="face" bind:this={btn} aria-label="Brush preset picker" data-tip="Click to open the Brush Preset picker" onclick={() => (open = !open)}>
    <canvas class="tipc" bind:this={face}></canvas>
    <span class="size">{Math.round(brushStore.settings.size)}</span>
    <Icon name="caret-small" size={12} />
  </button>
  <Popover anchor={btn} open={open} onclose={() => (open = false)} minWidth={300}>
    <div class="pop">
      <canvas class="strip" bind:this={strip}></canvas>
      <div class="row">
        <ScrubbyNumber label="Size" value={brushStore.settings.size} min={1} max={2500} log unit="px" width={52} onchange={(v) => brushStore.update({ size: v })} />
        <ScrubbyNumber label="Hardness" value={brushStore.settings.hardness} min={0} max={100} unit="%" width={44} disabled={!roundTip} onchange={(v) => brushStore.update({ hardness: v })} />
      </div>
      <div class="grid" role="listbox" aria-label="Brush presets">
        {#each brushStore.presets as p (p.id)}
          <button type="button" role="option" class="cell" class:on={p.id === brushStore.presetId} aria-selected={p.id === brushStore.presetId} title={p.name} onclick={() => pick(p.id)}>
            <canvas class="pc" use:thumb={p.settings}></canvas>
            <span class="pn">{p.name}</span>
          </button>
        {/each}
      </div>
      <div class="foot">
        <button type="button" class="btn sm" onclick={openPanel}>Brush Settings…</button>
      </div>
    </div>
  </Popover>
</span>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
  }
  .face {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 2px 0 3px;
    border-radius: 2px;
    color: var(--ps-text);
  }
  .face:hover {
    background: var(--ps-hover);
  }
  .tipc {
    width: 22px;
    height: 22px;
    display: block;
  }
  .size {
    min-width: 22px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .pop {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 318px;
    padding: 6px;
  }
  .strip {
    display: block;
    width: 100%;
    height: 44px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    max-height: 236px;
    overflow: auto;
    padding: 2px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    padding: 3px;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .cell:hover {
    background: var(--ps-hover);
  }
  .cell.on {
    border-color: var(--ps-accent);
    color: var(--ps-text);
  }
  .pc {
    display: block;
    width: 100%;
    height: 28px;
  }
  .pn {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
  }
</style>
