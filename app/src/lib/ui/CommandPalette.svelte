<script lang="ts">
  import Icon from "./icons/Icon.svelte";
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
    <div class="palette ps-popup" role="dialog" aria-label="Command palette">
      <div class="search">
        <Icon name="search" size={14} />
        <input bind:this={input} bind:value={query} type="text" placeholder="Search commands, tools, panels…" spellcheck="false" autocomplete="off" />
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
    /* Above dialogs (950) and the filters' live-preview dialogs (900). */
    z-index: 960;
    background: rgba(0, 0, 0, 0.25);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 10vh;
  }
  .palette {
    width: 520px;
    max-width: calc(100vw - 32px);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--ps-app);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    background: var(--ps-panel-head);
    border-bottom: 1px solid var(--ps-border-dark);
    color: var(--ps-text-dim);
  }
  .search input {
    flex: 1;
    background: none;
    border: 0;
    outline: none;
    color: var(--ps-text);
    font: inherit;
    font-size: var(--fs-menu);
    user-select: text;
    -webkit-user-select: text;
  }
  kbd {
    font-size: var(--fs-xs);
    padding: 1px 4px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px var(--ps-border-light);
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .list {
    overflow-y: auto;
    padding: 3px 0;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 24px;
    padding: 0 10px;
    text-align: left;
    font-size: var(--fs-menu);
    color: var(--ps-text);
  }
  .row.sel {
    background: var(--ps-row-selected);
  }
  .row.disabled {
    color: var(--ps-text-disabled);
  }
  .hit {
    color: #fff;
    text-decoration: underline;
    text-decoration-color: var(--ps-accent);
    text-underline-offset: 2px;
  }
  .menu {
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .sc {
    color: var(--ps-text-dim);
    font-size: var(--fs-sm);
    min-width: 48px;
    text-align: right;
  }
  .empty {
    padding: 16px;
    text-align: center;
    color: var(--ps-text-dim);
  }
</style>
