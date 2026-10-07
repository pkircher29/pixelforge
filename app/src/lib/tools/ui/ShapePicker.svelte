<script lang="ts">
  /** Custom Shape picker: current shape thumbnail, popover grid grouped like PS's shape sets. */
  import Popover from "$lib/ui/controls/Popover.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { CUSTOM_SHAPES, CUSTOM_SHAPE_GROUPS, customShapePath } from "../custom-shapes";
  import type { Path } from "$lib/engine";

  interface Props {
    value: string;
    onchange: (v: string) => void;
  }
  let { value, onchange }: Props = $props();
  let btn = $state<HTMLButtonElement | null>(null);
  let open = $state(false);

  function drawShape(el: HTMLCanvasElement, id: string) {
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(el.clientWidth * dpr);
      const h = Math.round(el.clientHeight * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      const g = el.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, w, h);
      const pad = Math.round(3 * dpr);
      const p: Path = customShapePath(id);
      g.beginPath();
      for (const sp of p.subpaths) {
        sp.anchors.forEach((a, i) => {
          const X = (v: number) => pad + v * (w - pad * 2);
          const Y = (v: number) => pad + v * (h - pad * 2);
          if (i === 0) g.moveTo(X(a.x), Y(a.y));
          else {
            const prev = sp.anchors[i - 1]!;
            g.bezierCurveTo(X(prev.outX), Y(prev.outY), X(a.inX), Y(a.inY), X(a.x), Y(a.y));
          }
        });
        if (sp.closed && sp.anchors.length > 1) {
          const last = sp.anchors[sp.anchors.length - 1]!;
          const first = sp.anchors[0]!;
          const X = (v: number) => pad + v * (w - pad * 2);
          const Y = (v: number) => pad + v * (h - pad * 2);
          g.bezierCurveTo(X(last.outX), Y(last.outY), X(first.inX), Y(first.inY), X(first.x), Y(first.y));
          g.closePath();
        }
      }
      g.fillStyle = "#e6e6e6";
      g.fill("evenodd");
    };
    draw();
    return { update: draw };
  }
  const current = $derived(CUSTOM_SHAPES.find((s) => s.id === value) ?? CUSTOM_SHAPES[0]!);
</script>

<span class="wrap">
  <span class="lbl">Shape:</span>
  <button type="button" class="face" bind:this={btn} aria-label="Custom shape picker" title={current.name} onclick={() => (open = !open)}>
    <canvas class="c" use:drawShape={current.id}></canvas>
    <Icon name="caret-small" size={12} />
  </button>
  <Popover anchor={btn} open={open} onclose={() => (open = false)} minWidth={240}>
    <div class="pop">
      {#each CUSTOM_SHAPE_GROUPS as group (group)}
        <div class="gh">{group}</div>
        <div class="grid">
          {#each CUSTOM_SHAPES.filter((s) => s.group === group) as s (s.id)}
            <button type="button" class="cell" class:on={s.id === value} title={s.name} aria-label={s.name} onclick={() => { onchange(s.id); open = false; }}>
              <canvas class="c2" use:drawShape={s.id}></canvas>
            </button>
          {/each}
        </div>
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
  }
  .pop {
    width: 248px;
    max-height: 320px;
    overflow: auto;
    padding: 4px;
  }
  .gh {
    padding: 4px 2px 2px;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .cell {
    width: 32px;
    height: 32px;
    padding: 2px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: var(--ps-input);
  }
  .cell:hover {
    border-color: var(--ps-border-light);
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
