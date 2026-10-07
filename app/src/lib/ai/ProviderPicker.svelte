<script lang="ts">
  /**
   * Provider row for the AI panel, PS idiom: `Provider: [glyph  Name  ▾] [⚙]`. The popup
   * lists every image-capable provider (built-ins first, then custom / local), each with
   * its brand-neutral glyph, a dim "no key" note when it isn't ready and a ✓ on the current
   * one. Layout rules (which providers are shown) stay in `picker.ts`.
   */
  import Popover from "$lib/ui/controls/Popover.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import ProviderGlyph from "./ProviderGlyph.svelte";
  import { chipTitle, pickerLayout, DEFAULT_MAX_CHIPS } from "$lib/ai/picker";
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
  const current = $derived(all.find((p) => p.id === selected) ?? null);
  const builtins = $derived(all.filter((p) => p.kind === "builtin"));
  const customs = $derived(all.filter((p) => p.kind !== "builtin"));

  let open = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);

  function pick(id: ProviderId): void {
    open = false;
    onselect(id);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const i = all.findIndex((p) => p.id === selected);
    const n = all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length];
    if (n) onselect(n.id);
  }
</script>

<div class="picker">
  <span class="lbl">Provider:</span>
  <button type="button" class="sel" class:open bind:this={btn} aria-haspopup="listbox" aria-expanded={open} aria-label="Provider" title={current ? chipTitle(current) : "Choose a provider"} onclick={() => (open = !open)} onkeydown={onKey}>
    {#if current}
      <ProviderGlyph provider={current} />
      <span class="name">{current.name}</span>
      {#if !isReady(current)}<span class="nokey">no key</span>{/if}
    {:else}
      <span class="name dim">{all.length ? "Choose…" : "No providers"}</span>
    {/if}
    <Icon name="caret-small" size={12} />
  </button>
  <button type="button" class="icon-btn manage" data-tip="AI Providers…" aria-label="AI Providers" onclick={onmanage}><Icon name="gear" size={14} /></button>

  <Popover anchor={btn} {open} onclose={() => (open = false)} minWidth={btn?.offsetWidth ?? 160}>
    <div class="list" role="listbox" aria-label="Providers">
      {#each builtins as p (p.id)}
        <button type="button" role="option" class="row" class:on={p.id === selected} aria-selected={p.id === selected} title={chipTitle(p)} onclick={() => pick(p.id)}>
          <span class="chk">{#if p.id === selected}<Icon name="check" size={12} />{/if}</span>
          <ProviderGlyph provider={p} />
          <span class="rname">{p.name}</span>
          <span class="meta">{isReady(p) ? p.vendor : "no key"}</span>
        </button>
      {/each}
      {#if builtins.length && customs.length}<div class="sep"></div>{/if}
      {#each customs as p (p.id)}
        <button type="button" role="option" class="row" class:on={p.id === selected} aria-selected={p.id === selected} title={chipTitle(p)} onclick={() => pick(p.id)}>
          <span class="chk">{#if p.id === selected}<Icon name="check" size={12} />{/if}</span>
          <ProviderGlyph provider={p} />
          <span class="rname">{p.name}</span>
          <span class="meta">{p.local ? "local" : isReady(p) ? p.vendor : "no key"}</span>
        </button>
      {/each}
      <div class="sep"></div>
      <button type="button" class="row" onclick={() => { open = false; onmanage(); }}>
        <span class="chk"></span><span class="rname">Manage Providers…</span>
      </button>
    </div>
  </Popover>
</div>

<style>
  .picker {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--row-h);
  }
  .lbl {
    width: 52px;
    flex: none;
    color: var(--ps-text-dim);
  }
  .sel {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    height: var(--input-h);
    padding: 0 2px 0 5px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.25);
    border-radius: 2px;
    color: var(--ps-text);
    text-align: left;
  }
  .sel:hover,
  .sel.open {
    border-color: var(--ps-border-light);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dim,
  .nokey {
    color: var(--ps-text-disabled);
  }
  .nokey {
    font-size: var(--fs-xs);
  }
  .manage {
    flex: none;
  }
  .list {
    display: flex;
    flex-direction: column;
    max-height: 60vh;
    overflow: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--row-h);
    padding: 0 10px 0 2px;
    text-align: left;
    white-space: nowrap;
    color: var(--ps-text);
  }
  .row:hover {
    background: var(--ps-row-selected);
  }
  .row.on {
    background: var(--ps-row-selected-inactive);
  }
  .chk {
    display: grid;
    width: 14px;
    place-items: center;
  }
  .rname {
    flex: 1;
  }
  .meta {
    padding-left: 16px;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .sep {
    height: 1px;
    margin: 3px 0;
    background: var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
  }
</style>
