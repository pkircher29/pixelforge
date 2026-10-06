<script lang="ts">
  import type { Layer } from "$lib/engine";
  import { drawThumb } from "./thumbnail";

  interface Props {
    layer: Layer;
    docW: number;
    docH: number;
    /** Redraw trigger (doc pixelVersion). */
    version: number;
  }
  let { layer, docW, docH, version }: Props = $props();
  let canvas = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    const el = canvas;
    void version;
    void layer.offset.x;
    void layer.offset.y;
    if (!el) return;
    // Debounce bursts of pixel changes (brush strokes) to ~8 fps.
    const t = setTimeout(() => drawThumb(el, layer, docW, docH), 120);
    return () => clearTimeout(t);
  });
</script>

<canvas class="thumb" bind:this={canvas} class:group={layer.kind === "group"} aria-hidden="true"></canvas>

<style>
  .thumb {
    width: 44px;
    height: 32px;
    border-radius: 3px;
    border: 1px solid var(--border-strong);
    background:
      linear-gradient(45deg, #6b7080 25%, transparent 25%, transparent 75%, #6b7080 75%),
      linear-gradient(45deg, #6b7080 25%, #9ba1b0 25%, #9ba1b0 75%, #6b7080 75%);
    background-size: 8px 8px;
    background-position: 0 0, 4px 4px;
    image-rendering: pixelated;
  }
  .thumb.group {
    background: var(--bg-3);
  }
</style>
