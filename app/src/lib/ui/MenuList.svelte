<script lang="ts">
  /** Recursive PS dropdown: 24px rows, ✓ column, dim right-aligned shortcut, ▸ submenus. */
  import MenuList from "./MenuList.svelte";
  import Icon from "./icons/Icon.svelte";
  import { hasCheckColumn, itemState, type MenuNode } from "./menu";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";

  interface Props {
    nodes: MenuNode[];
    onrun: () => void;
    depth?: number;
  }
  let { nodes, onrun, depth = 0 }: Props = $props();

  let openSub = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const checks = $derived(hasCheckColumn(nodes));

  function enterSub(path: string) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (openSub = path), 120);
  }
  function enterItem() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (openSub = null), 200);
  }
</script>

<div class="list ps-popup" role="menu" style:--depth={depth}>
  {#each nodes as n, i (n.type === "separator" ? `sep-${i}` : n.type === "item" ? n.command.id : n.path)}
    {#if n.type === "separator"}
      <div class="sep" role="separator"></div>
    {:else if n.type === "item"}
      {@const st = itemState(n.command)}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={st.checked}
        class="item"
        disabled={st.disabled}
        onpointerenter={enterItem}
        onclick={() => {
          onrun();
          void n.command.run();
        }}
      >
        <span class="chk" class:hidden={!checks && !st.checked}>{#if st.checked}<Icon name="check" size={12} />{/if}</span>
        <span class="label">{n.command.label}</span>
        {#if n.command.shortcut}<span class="sc">{formatShortcut(n.command.shortcut, IS_MAC)}</span>{/if}
      </button>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="subwrap" onpointerenter={() => enterSub(n.path)}>
        <button type="button" role="menuitem" class="item" class:open={openSub === n.path} aria-haspopup="menu" onclick={() => (openSub = n.path)}>
          <span class="chk" class:hidden={!checks}></span>
          <span class="label">{n.label}</span>
          <span class="chev"><Icon name="chevron-right" size={10} /></span>
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
    min-width: 200px;
    padding: 3px 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0;
    width: 100%;
    height: 24px;
    padding: 0 12px 0 6px;
    text-align: left;
    font-size: var(--fs-menu);
    color: var(--ps-text);
    white-space: nowrap;
  }
  .item:not(:disabled):hover,
  .item.open {
    background: var(--ps-row-selected);
  }
  .item:disabled {
    color: var(--ps-text-disabled);
  }
  .chk {
    display: grid;
    place-items: center;
    width: 16px;
    margin-right: 2px;
    flex: none;
  }
  .chk.hidden {
    width: 6px;
  }
  .label {
    flex: 1;
    padding-right: 28px;
  }
  .sc {
    color: var(--ps-text-dim);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .item:disabled .sc {
    color: var(--ps-text-disabled);
  }
  .chev {
    display: grid;
    color: var(--ps-text-dim);
    margin-right: -6px;
  }
  .sep {
    height: 1px;
    margin: 3px 1px;
    background: var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
  }
  .subwrap {
    position: relative;
  }
  .sub {
    position: absolute;
    left: calc(100% - 3px);
    top: -4px;
  }
</style>
