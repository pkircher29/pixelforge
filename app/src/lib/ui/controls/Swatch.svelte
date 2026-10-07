<script lang="ts">
  import { swatchCss, type SwatchColor } from "./swatch";
  let { color = "transparent", background }: { color?: SwatchColor; background?: string } = $props();
</script>

<span class="color-swatch" aria-hidden="true"><span class="paint" style:background={background ?? swatchCss(color)}></span></span>

<style>
  .color-swatch {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    pointer-events: none;
    background-color: var(--ps-swatch-light);
    background-image: conic-gradient(var(--ps-swatch-dark) 25%, transparent 0 50%, var(--ps-swatch-dark) 0 75%, transparent 0);
    background-size: 8px 8px;
  }
  .paint { position: absolute; inset: 0; }
</style>
