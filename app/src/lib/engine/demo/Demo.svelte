<script lang="ts">
  /**
   * Dev-only visual check for the compositor. Mount anywhere (e.g. temporarily in
   * App.svelte): `<Demo />`. Shows 4 layers (Multiply / Screen / Hue + background),
   * an elliptical selection with marching ants, wheel zoom, drag pan, and buttons to
   * paint, cycle the active layer's blend mode, toggle visibility and undo.
   */
  import { mountDemo, type DemoHandle } from "./demo";
  import { BLEND_MODE_LABEL } from "../blend";
  import { formatZoom } from "../viewport";

  interface Props {
    forceCanvas2d?: boolean;
  }

  let { forceCanvas2d = false }: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let handle = $state<DemoHandle | null>(null);
  let tick = $state(0);
  let error = $state<string | null>(null);

  $effect(() => {
    const el = canvas;
    if (!el) return;
    let h: DemoHandle;
    try {
      h = mountDemo(el, { forceCanvas2d });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    handle = h;
    const timer = setInterval(() => (tick += 1), 250);
    return () => {
      clearInterval(timer);
      h.dispose();
      handle = null;
    };
  });

  const info = $derived.by(() => {
    void tick;
    const h = handle;
    if (!h) return null;
    const s = h.stats();
    return {
      kind: h.compositor.kind,
      zoom: formatZoom(h.viewport.zoom),
      recomposited: s.recomposited,
      passes: s.passes,
      uploads: s.uploads,
      layers: h.doc.layers.map((l) => ({
        id: l.id,
        name: l.name,
        mode: BLEND_MODE_LABEL[l.blendMode],
        opacity: Math.round(l.opacity * 100),
        visible: l.visible,
        active: l.id === h.doc.activeLayerId,
      })),
      canUndo: h.history.canUndo,
    };
  });

  function paint(): void {
    const h = handle;
    if (!h) return;
    h.paintDot(100 + Math.random() * 440, 80 + Math.random() * 320);
    tick += 1;
  }

  function cycle(): void {
    handle?.cycleBlendMode();
    tick += 1;
  }

  function toggle(id: string): void {
    const h = handle;
    if (!h) return;
    const l = h.doc.layers.find((x) => x.id === id);
    if (l) l.visible = !l.visible;
    tick += 1;
  }

  function activate(id: string): void {
    const h = handle;
    if (!h) return;
    h.doc.activeLayerId = id;
    tick += 1;
  }

  function undo(): void {
    handle?.history.undo();
    tick += 1;
  }
</script>

<div class="demo">
  <canvas bind:this={canvas} aria-label="Engine demo canvas"></canvas>
  <div class="hud">
    {#if error}
      <strong>Failed: {error}</strong>
    {:else if info}
      <div class="row">
        <strong>{info.kind}</strong>
        <span>zoom {info.zoom}</span>
        <span>passes {info.passes}</span>
        <span>uploads {info.uploads}</span>
        <span class:hot={info.recomposited}>{info.recomposited ? "recomposited" : "cached"}</span>
      </div>
      <div class="row">
        <button onclick={paint}>Paint dot</button>
        <button onclick={cycle}>Cycle blend mode</button>
        <button onclick={undo} disabled={!info.canUndo}>Undo</button>
      </div>
      <ul>
        {#each [...info.layers].reverse() as l (l.id)}
          <li class:active={l.active}>
            <button class="link" onclick={() => toggle(l.id)} title="Toggle visibility">{l.visible ? "o" : "-"}</button>
            <button class="link" onclick={() => activate(l.id)}>{l.name}</button>
            <span class="muted">{l.mode} {l.opacity}%</span>
          </li>
        {/each}
      </ul>
      <p class="muted">Wheel = zoom at cursor, drag = pan.</p>
    {/if}
  </div>
</div>

<style>
  .demo {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 320px;
    background: #0b0d12;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  .hud {
    position: absolute;
    top: 10px;
    left: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(12, 14, 22, 0.8);
    color: #dfe3ee;
    font: 12px/1.5 system-ui, sans-serif;
    backdrop-filter: blur(6px);
    max-width: 320px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 4px;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  li {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  li.active {
    color: #7c5cff;
  }
  .link {
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font: inherit;
  }
  button:not(.link) {
    background: #1b1f2e;
    color: inherit;
    border: 1px solid #2c3246;
    border-radius: 6px;
    padding: 2px 8px;
    cursor: pointer;
    font: inherit;
  }
  .muted {
    color: #8b93a7;
  }
  .hot {
    color: #22d3ee;
  }
</style>
