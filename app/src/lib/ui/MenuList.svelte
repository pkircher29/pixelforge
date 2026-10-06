<script lang="ts">
  /** Recursive dropdown list for the menu bar. */
  import { ChevronRight } from "@lucide/svelte";
  import MenuList from "./MenuList.svelte";
  import type { MenuNode } from "./menu";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";

  interface Props {
    nodes: MenuNode[];
    onrun: () => void;
    depth?: number;
  }
  let { nodes, onrun, depth = 0 }: Props = $props();

  let openSub = $state<string | null>(null);
</script>

<div class="list glass" role="menu" style:--depth={depth}>
  {#each nodes as n, i (n.type === "separator" ? `sep-${i}` : n.type === "item" ? n.command.id : n.path)}
    {#if n.type === "separator"}
      <div class="sep" role="separator"></div>
    {:else if n.type === "item"}
      {@const disabled = n.command.enabled ? !n.command.enabled() : false}
      <button
        type="button"
        role="menuitem"
        class="item"
        {disabled}
        onpointerenter={() => (openSub = null)}
        onclick={() => {
          onrun();
          void n.command.run();
        }}
      >
        <span class="label">{n.command.label}</span>
        {#if n.command.shortcut}<span class="sc">{formatShortcut(n.command.shortcut, IS_MAC)}</span>{/if}
      </button>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="subwrap" onpointerenter={() => (openSub = n.path)}>
        <button type="button" role="menuitem" class="item" class:open={openSub === n.path} aria-haspopup="menu">
          <span class="label">{n.label}</span>
          <span class="chev"><ChevronRight size={12} /></span>
        </button>
        {#if openSub === n.path}
          <div class="sub">
            <MenuList nodes={n.children} {onrun} depth={depth + 1} />
          </div>
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .list {
    min-width: 220px;
    padding: 5px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding: 5px 10px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-sm);
    color: var(--fg-0);
    white-space: nowrap;
  }
  .item:not(:disabled):hover,
  .item.open {
    background: var(--accent-soft);
  }
  .item:disabled {
    color: var(--fg-2);
  }
  .label {
    flex: 1;
  }
  .sc {
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .chev {
    display: grid;
    color: var(--fg-2);
  }
  .sep {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
  .subwrap {
    position: relative;
  }
  .sub {
    position: absolute;
    left: calc(100% - 2px);
    top: -5px;
  }
</style>
