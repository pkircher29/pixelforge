<script lang="ts">
  /**
   * One thumbnail cell of a Layers-panel row: the layer's pixels over a checkerboard
   * (doc-aspect, white hairline), the PS icon tile for adjustment / group layers, a
   * "T" for type layers, or the layer mask (black / white, red X when disabled). A
   * `framed` thumb (PS "targeted") gets the double border.
   */
  import type { Layer } from "$lib/engine";
  import Icon from "../icons/Icon.svelte";
  import { drawLayerThumb, drawMaskThumb } from "./thumbnail";
  import type { ThumbContents } from "./Layers.store.svelte";

  interface Props {
    layer: Layer;
    docW: number;
    docH: number;
    w: number;
    h: number;
    /** Redraw trigger (doc pixelVersion). */
    version: number;
    mode?: "layer" | "mask";
    contents?: ThumbContents;
    framed?: boolean;
    disabled?: boolean;
  }
  let { layer, docW, docH, w, h, version, mode = "layer", contents = "document", framed = false, disabled = false }: Props = $props();
  let canvas = $state<HTMLCanvasElement | null>(null);

  const iconTile = $derived(mode === "layer" && (layer.kind === "adjustment" || layer.kind === "group" || layer.kind === "text"));
  const tileIcon = $derived(layer.kind === "group" ? (layer.collapsed ? "folder" : "folder-open") : layer.kind === "adjustment" ? "adjustment" : "kind-type");

  $effect(() => {
    const el = canvas;
    void version;
    void layer.offset.x;
    void layer.offset.y;
    void contents;
    if (!el || iconTile) return;
    // Debounce bursts of pixel changes (brush strokes) to ~8 fps.
    const t = setTimeout(() => {
      if (mode === "mask") drawMaskThumb(el, layer, docW, docH, w, h);
      else drawLayerThumb(el, layer, docW, docH, w, h, contents);
    }, 90);
    return () => clearTimeout(t);
  });
</script>

<span class="thumb" class:framed class:mask={mode === "mask"} class:tile={iconTile} style:width="{w}px" style:height="{h}px" aria-hidden="true">
  {#if iconTile}
    <Icon name={tileIcon} size={Math.min(20, h - 6)} />
  {:else}
    <canvas bind:this={canvas}></canvas>
  {/if}
  {#if disabled}
    <span class="x"></span>
  {/if}
</span>

<style>
  .thumb {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    box-sizing: content-box;
    border: 1px solid #0a0a0a;
    outline: 1px solid #c8c8c8;
    outline-offset: -2px;
    background: #ffffff;
    overflow: hidden;
    image-rendering: pixelated;
  }
  .thumb.tile {
    background: #a8a8a8;
    color: #2a2a2a;
    outline-color: #d8d8d8;
  }
  .thumb.framed {
    outline: 2px solid var(--ps-text);
    outline-offset: -3px;
    box-shadow: 0 0 0 1px var(--ps-text);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .x::before,
  .x::after {
    content: "";
    position: absolute;
    left: -20%;
    right: -20%;
    top: 50%;
    height: 2px;
    background: #e02020;
    transform: rotate(45deg);
  }
  .x::after {
    transform: rotate(-45deg);
  }
</style>
