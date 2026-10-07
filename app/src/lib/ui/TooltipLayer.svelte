<script lang="ts">
  import { onMount, tick } from "svelte";
  import { settings } from "$lib/stores/settings.svelte";

  let text = $state("");
  let left = $state(0);
  let top = $state(0);
  let placed = $state(false);
  let bubble = $state<HTMLDivElement>();
  let anchor: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(timer);
    if (anchor) {
      const ids = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/)
        .filter((id) => id && id !== "app-tooltip");
      if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
      else anchor.removeAttribute("aria-describedby");
    }
    anchor = null;
    text = "";
    placed = false;
  }

  function schedule(target: EventTarget | null, immediate = false) {
    const next = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
    if (next === anchor) return;
    hide();
    if (!next?.dataset.tip || !settings.value.showToolTips || next.closest(".toolbar.flyopen")) return;
    anchor = next;
    timer = setTimeout(async () => {
      if (anchor !== next || !next.isConnected) return;
      text = next.dataset.tip ?? "";
      await tick();
      if (anchor !== next || !bubble) return;
      const r = next.getBoundingClientRect();
      const b = bubble.getBoundingClientRect();
      const gap = 6, margin = 8;
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      let x = r.left + (r.width - b.width) / 2;
      let y = r.bottom + gap;
      if (next.closest('aside[aria-label="Tools"]')) {
        x = r.right + gap;
        if (x + b.width > width - margin) x = r.left - b.width - gap;
        y = r.top + (r.height - b.height) / 2;
      } else if (next.closest("footer") || next.classList.contains("tip-up")) {
        y = r.top - b.height - gap;
        if (y < margin) y = r.bottom + gap;
      } else if (y + b.height > height - margin) {
        y = r.top - b.height - gap;
      }
      left = Math.max(margin, Math.min(x, width - b.width - margin));
      top = Math.max(margin, Math.min(y, height - b.height - margin));
      const ids = next.getAttribute("aria-describedby");
      next.setAttribute("aria-describedby", [ids, "app-tooltip"].filter(Boolean).join(" "));
      placed = true;
    }, immediate ? 0 : 600);
  }

  $effect(() => { if (!settings.value.showToolTips) hide(); });

  onMount(() => {
    const over = (e: PointerEvent) => { if (e.pointerType !== "touch") schedule(e.target); };
    const out = (e: PointerEvent) => {
      if (anchor && !(e.relatedTarget instanceof Node && anchor.contains(e.relatedTarget))) hide();
    };
    const focus = (e: FocusEvent) => schedule(e.target, true);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  });
</script>

{#if text}
  <div bind:this={bubble} id="app-tooltip" role="tooltip" style:left="{left}px" style:top="{top}px" style:visibility={placed ? "visible" : "hidden"}>{text}</div>
{/if}

<style>
  div {
    position: fixed;
    z-index: 10000;
    width: max-content;
    max-width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: hidden;
    padding: 3px 6px;
    border-radius: 2px;
    background: var(--ps-panel);
    border: 1px solid var(--ps-border-dark);
    color: var(--ps-text);
    font-size: var(--fs-sm);
    font-weight: 400;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    pointer-events: none;
  }
</style>
