<script lang="ts">
  /**
   * Anchored PS popup (dropdown lists, ▾ slider popovers, status-bar menus). Positions
   * itself below (or above when there's no room) the `anchor` element, closes on outside
   * pointer-down, Escape or window blur.
   */
  import type { Snippet } from "svelte";

  interface Props {
    anchor: HTMLElement | null;
    open: boolean;
    onclose: () => void;
    /** Horizontal alignment relative to the anchor. */
    align?: "left" | "right";
    /** Prefer opening upwards (status bar). */
    up?: boolean;
    minWidth?: number;
    children: Snippet;
    class?: string;
  }
  let { anchor, open, onclose, align = "left", up = false, minWidth = 0, children, class: cls = "" }: Props = $props();

  let el = $state<HTMLDivElement | null>(null);
  let x = $state(0);
  let y = $state(0);
  let placed = $state(false);

  $effect(() => {
    if (!open || !anchor || !el) {
      placed = false;
      return;
    }
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === "right" ? a.right - w : a.left;
    left = Math.max(4, Math.min(vw - w - 4, left));
    let top = up ? a.top - h - 2 : a.bottom + 2;
    if (!up && top + h > vh - 4) top = a.top - h - 2;
    if (up && top < 4) top = a.bottom + 2;
    x = Math.round(left);
    y = Math.round(Math.max(4, top));
    placed = true;
  });

  function onWindowDown(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (el?.contains(t) || anchor?.contains(t)) return;
    onclose();
  }
  function onKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={onKey} onblur={() => open && onclose()} />

{#if open}
  <div class="pop ps-popup {cls}" bind:this={el} style:left="{x}px" style:top="{y}px" style:min-width="{minWidth}px" style:visibility={placed ? "visible" : "hidden"} role="dialog">
    {@render children()}
  </div>
{/if}

<style>
  .pop {
    position: fixed;
    z-index: 700;
    padding: 3px;
  }
</style>
