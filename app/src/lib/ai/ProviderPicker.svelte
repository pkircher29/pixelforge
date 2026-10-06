<script lang="ts">
  /**
   * Compact provider picker for the AI panel: up to `maxChips` chips plus a dropdown for
   * the rest (and for everything, so N providers stay reachable), a manage button that
   * opens the AI Providers dialog. Local providers get a 🖥 glyph. Pure layout rules in
   * `picker.ts`. Flat, dense markup so it fits the Photoshop restyle (Wave 6).
   */
  import { chipGlyph, chipTitle, pickerLayout, DEFAULT_MAX_CHIPS } from "$lib/ai/picker";
  import { isReady, type ProviderId, type ProviderInfo } from "$lib/ai/types";

  interface Props {
    providers: readonly ProviderInfo[];
    selected: ProviderId | null;
    onselect: (id: ProviderId) => void;
    onmanage: () => void;
    maxChips?: number;
  }
  const { providers, selected, onselect, onmanage, maxChips = DEFAULT_MAX_CHIPS }: Props = $props();

  const layout = $derived(pickerLayout(providers, selected, maxChips));
  const all = $derived([...layout.chips, ...layout.overflow]);
</script>

<div class="picker" role="radiogroup" aria-label="Provider">
  {#each layout.chips as p (p.id)}
    <button
      type="button"
      class="chip"
      class:on={selected === p.id}
      class:local={p.local}
      role="radio"
      aria-checked={selected === p.id}
      title={chipTitle(p)}
      onclick={() => onselect(p.id)}
    >
      <span class="dot" class:ok={isReady(p)}></span>
      <span class="name">{chipGlyph(p)}{p.name}</span>
    </button>
  {/each}
  {#if layout.hasOverflow}
    <select class="more" aria-label="More providers" value={selected ?? ""} onchange={(e) => onselect((e.currentTarget as HTMLSelectElement).value as ProviderId)}>
      {#each all as p (p.id)}
        <option value={p.id}>{p.local ? "🖥 " : ""}{p.name}{isReady(p) ? "" : " (no key)"}</option>
      {/each}
    </select>
  {/if}
  <button type="button" class="manage" title="AI Providers…" aria-label="AI Providers" onclick={onmanage}>⚙</button>
</div>

<style>
  .picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    min-height: 22px;
    font-size: 11px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 7px;
    border-radius: 2px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    color: var(--fg-1);
    white-space: nowrap;
  }
  .chip:hover {
    color: var(--fg-0);
    border-color: var(--border-strong);
  }
  .chip.on {
    background: var(--accent-soft, var(--bg-3));
    border-color: var(--accent);
    color: var(--fg-0);
  }
  .name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-2);
    flex: none;
  }
  .dot.ok {
    background: #43d17a;
  }
  .more {
    height: 20px;
    max-width: 150px;
    font: inherit;
    font-size: 11px;
    color: var(--fg-0);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 0 4px;
  }
  .manage {
    height: 20px;
    width: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    color: var(--fg-2);
    margin-left: auto;
  }
  .manage:hover {
    color: var(--fg-0);
    background: var(--bg-3);
  }
</style>
