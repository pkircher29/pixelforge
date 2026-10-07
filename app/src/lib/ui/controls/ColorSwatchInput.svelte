<script lang="ts">
  import Swatch from "./Swatch.svelte";
  import type { SwatchColor } from "./swatch";
  interface Props {
    value: string;
    color?: SwatchColor;
    label: string;
    disabled?: boolean;
    width?: number;
    height?: number;
    autofocus?: boolean;
    oninput: (event: Event & { currentTarget: HTMLInputElement }) => void;
  }
  let { value, color, label, disabled = false, width = 40, height = 18, autofocus = false, oninput }: Props = $props();
</script>

<span class="color-input" class:disabled style:width="{width}px" style:height="{height}px">
  <Swatch color={color ?? value} />
  <input type="color" {value} {disabled} {oninput} aria-label={label} data-autofocus={autofocus ? "" : undefined} />
</span>

<style>
  .color-input { position: relative; display: inline-block; flex: none; vertical-align: middle; border: 1px solid var(--ps-border-dark); }
  .color-input:focus-within { outline: 1px solid var(--ps-accent); outline-offset: 1px; }
  .disabled { opacity: 0.5; }
  input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  input:disabled { cursor: default; }
</style>
