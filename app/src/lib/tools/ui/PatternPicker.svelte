<script lang="ts">
  /** Pattern picker (Pattern Stamp): tile thumbnail + popover grid. */
  import Popover from "$lib/ui/controls/Popover.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { builtinPatterns, patternById } from "../patterns";

  interface Props {
    value: string;
    onchange: (v: string) => void;
  }
  let { value, onchange }: Props = $props();
  let btn = $state<HTMLButtonElement | null>(null);
  let open = $state(false);

  function draw(el: HTMLCanvasElement, id: string) {
    const run = () => {
      const p = patternById(id).raster;
      el.width = p.width;
      el.height = p.height;
      el.getContext("2d")?.putImageData(p.toImageData(), 0, 0);
    };
    run();
    return { update: run };
  }
</script>

<span class="wrap">
  <span class="lbl">Pattern:</span>
  <button type="button" class="face" bind:this={btn} aria-label="Pattern picker" title={patternById(value).name} onclick={() => (open = !open)}>
    <canvas class="c" use:draw={value}></canvas>
    <Icon name="caret-small" size={12} />
  </button>
  <Popover anchor={btn} open={open} onclose={() => (open = false)} minWidth={180}>
    <div class="grid">
      {#each builtinPatterns() as p (p.id)}
        <button type="button" class="cell" class:on={p.id === value} title={p.name} aria-label={p.name} onclick={() => { onchange(p.id); open = false; }}>
          <canvas class="c2" use:draw={p.id}></canvas>
        </button>
      {/each}
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
  .face {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 1px 0 2px;
    border-radius: 2px;
  }
  .face:hover {
    background: var(--ps-hover);
  }
  .c {
    width: 20px;
    height: 20px;
    display: block;
    border: 1px solid var(--ps-border-dark);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3px;
    padding: 4px;
  }
  .cell {
    width: 40px;
    height: 40px;
    padding: 1px;
    border: 1px solid var(--ps-border-dark);
  }
  .cell.on {
    border-color: var(--ps-accent);
  }
  .c2 {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
