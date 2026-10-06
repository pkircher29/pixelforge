<script lang="ts">
  import { Search } from "@lucide/svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { getCommands, type CommandDef } from "./registry.svelte";
  import { scoreCommand } from "./fuzzy";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";
  import { tick } from "svelte";

  let query = $state("");
  let index = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLDivElement | null>(null);

  interface Row {
    c: CommandDef;
    indices: number[];
  }

  const rows = $derived.by((): Row[] => {
    const cmds = getCommands();
    const q = query.trim();
    if (!q) {
      return cmds
        .filter((c) => c.menu)
        .slice()
        .sort((a, b) => (a.menu ?? "").localeCompare(b.menu ?? "") || (a.order ?? 0) - (b.order ?? 0))
        .slice(0, 60)
        .map((c) => ({ c, indices: [] }));
    }
    const scored: { c: CommandDef; score: number; indices: number[] }[] = [];
    for (const c of cmds) {
      const m = scoreCommand(q, c);
      if (m) scored.push({ c, score: m.score, indices: m.indices });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 40).map(({ c, indices }) => ({ c, indices }));
  });

  $effect(() => {
    if (ui.paletteOpen) {
      query = "";
      index = 0;
      void tick().then(() => input?.focus());
    }
  });

  $effect(() => {
    rows;
    index = 0;
  });

  function close() {
    ui.paletteOpen = false;
  }

  function run(c: CommandDef) {
    close();
    if (c.enabled && !c.enabled()) return;
    void c.run();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      index = Math.min(rows.length - 1, index + 1);
      scrollIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      index = Math.max(0, index - 1);
      scrollIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[index];
      if (r) run(r.c);
    }
    e.stopPropagation();
  }

  function scrollIntoView() {
    void tick().then(() => list?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function highlight(label: string, indices: number[]): { ch: string; hit: boolean }[] {
    const set = new Set(indices);
    return [...label].map((ch, i) => ({ ch, hit: set.has(i) }));
  }
</script>

{#if ui.paletteOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onpointerdown={(e) => e.target === e.currentTarget && close()} onkeydown={onkeydown}>
    <div class="palette glass" role="dialog" aria-label="Command palette">
      <div class="search">
        <Search size={15} />
        <input bind:this={input} bind:value={query} type="text" placeholder="Type a command…" spellcheck="false" autocomplete="off" />
        <kbd>Esc</kbd>
      </div>
      <div class="list" bind:this={list} role="listbox">
        {#each rows as r, i (r.c.id)}
          {@const disabled = r.c.enabled ? !r.c.enabled() : false}
          <button
            type="button"
            role="option"
            aria-selected={i === index}
            class="row"
            class:sel={i === index}
            class:disabled
            data-i={i}
            onpointermove={() => (index = i)}
            onclick={() => run(r.c)}
          >
            <span class="label">
              {#each highlight(r.c.label, r.indices) as p, k (k)}<span class:hit={p.hit}>{p.ch}</span>{/each}
            </span>
            {#if r.c.menu}<span class="menu">{r.c.menu.replace(/\//g, " › ")}</span>{/if}
            {#if r.c.shortcut}<span class="sc">{formatShortcut(r.c.shortcut, IS_MAC)}</span>{/if}
          </button>
        {:else}
          <div class="empty">No command matches “{query}”.</div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 95;
    background: rgba(4, 6, 10, 0.35);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
  }
  .palette {
    width: 560px;
    max-width: calc(100vw - 32px);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: rise var(--t-fast) ease-out;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-2);
  }
  .search input {
    flex: 1;
    background: none;
    border: 0;
    outline: none;
    color: var(--fg-0);
    font: inherit;
    font-size: var(--fs-lg);
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 5px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--fg-2);
  }
  .list {
    overflow-y: auto;
    padding: 6px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 7px 10px;
    border-radius: var(--radius-md);
    text-align: left;
    font-size: var(--fs-md);
  }
  .row.sel {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px rgba(139, 108, 255, 0.35);
  }
  .row.disabled {
    color: var(--fg-2);
  }
  .hit {
    color: var(--accent-2);
    font-weight: 600;
  }
  .menu {
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .sc {
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    min-width: 48px;
    text-align: right;
  }
  .empty {
    padding: 20px;
    text-align: center;
    color: var(--fg-2);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .palette {
      animation: none;
    }
  }
</style>
