<script lang="ts">
  /**
   * `<Icon name="brush" />` — a 16×16 Photoshop-style glyph from `icons.ts`, drawn in
   * `currentColor`. Unknown names render an empty box in dev so gaps are visible.
   */
  import { resolveIcon } from "./icons";

  interface Props {
    name: string;
    size?: number;
    /** Base stroke width (1.25 reads as PS's 1 px hairline at 100 %). */
    stroke?: number;
    class?: string;
    title?: string;
  }
  let { name, size = 16, stroke = 1.25, class: cls = "", title }: Props = $props();

  const def = $derived(resolveIcon(name));
</script>

<svg
  class="pf-icon {cls}"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={title ? undefined : "true"}
  role={title ? "img" : undefined}
  data-icon={name}
>
  {#if title}<title>{title}</title>{/if}
  {#if def}
    {#each def as p, i (i)}
      {#if p.f}
        <path d={p.d} fill="currentColor" stroke={p.s ? "currentColor" : "none"} opacity={p.o ?? 1} />
      {:else if p.k}
        <path d={p.d} fill="var(--icon-knockout, var(--ps-app, #323232))" stroke={p.s ? "currentColor" : "none"} stroke-width={p.w ?? stroke} opacity={p.o ?? 1} />
      {:else}
        <path d={p.d} stroke-width={p.w ?? stroke} stroke-dasharray={p.da} opacity={p.o ?? 1} />
      {/if}
    {/each}
  {:else if import.meta.env.DEV}
    <path d="M1.5 1.5h13v13h-13z" stroke-dasharray="2 2" opacity="0.5" />
  {/if}
</svg>

<style>
  .pf-icon {
    display: block;
    flex: none;
    shape-rendering: geometricPrecision;
  }
</style>
