<script lang="ts">
  /**
   * Brand-neutral 14 px provider glyphs drawn in `currentColor`: geometric marks for the
   * three built-ins, a monitor for local servers, a hex for hosted hubs, a speech mark for
   * prompt helpers. Never vendor logos.
   */
  import type { ProviderInfo } from "./types";

  interface Props {
    provider: Pick<ProviderInfo, "id" | "local" | "icon" | "kind">;
    size?: number;
  }
  let { provider, size = 14 }: Props = $props();

  const kind = $derived.by((): string => {
    if (provider.id === "open_ai") return "ring";
    if (provider.id === "x_ai") return "slash";
    if (provider.id === "gemini") return "star";
    if (provider.local || provider.icon === "local") return "monitor";
    if (provider.icon === "assist") return "speech";
    if (provider.icon === "hub") return "hex";
    return "cloud";
  });
</script>

<svg class="pg" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-glyph={kind}>
  {#if kind === "ring"}
    <path d="M8 2.2l5 2.9v5.8l-5 2.9-5-2.9V5.1z" />
    <path d="M8 5.6l2.1 1.2v2.4L8 10.4 5.9 9.2V6.8z" />
  {:else if kind === "slash"}
    <path d="M3 13L13 3" />
    <path d="M3 3l4 4M9 9l4 4" />
  {:else if kind === "star"}
    <path d="M8 1.8c.5 3.4 2.8 5.7 6.2 6.2-3.4.5-5.7 2.8-6.2 6.2-.5-3.4-2.8-5.7-6.2-6.2 3.4-.5 5.7-2.8 6.2-6.2z" />
  {:else if kind === "monitor"}
    <path d="M2 3.5h12v7.5H2z" />
    <path d="M6 14h4M8 11v3" />
  {:else if kind === "speech"}
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  {:else if kind === "hex"}
    <path d="M5 2.5h6l3 5.5-3 5.5H5L2 8z" />
  {:else}
    <path d="M4.5 12.5h7.2a2.8 2.8 0 00.4-5.6 4 4 0 00-7.7-.9A3.2 3.2 0 004.5 12.5z" />
  {/if}
</svg>

<style>
  .pg {
    display: block;
    flex: none;
  }
</style>
