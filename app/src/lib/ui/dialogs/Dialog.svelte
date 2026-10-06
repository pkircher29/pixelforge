<script lang="ts">
  /**
   * Modal dialog frame: glass backdrop, title, body, footer. Esc cancels, Enter submits
   * (unless focus is in a textarea), Tab is trapped inside, first field is focused.
   */
  import type { Snippet } from "svelte";
  import { X } from "@lucide/svelte";

  interface Props {
    title: string;
    width?: number;
    /** Called on Esc / close button. */
    oncancel: () => void;
    /** Called on Enter (when provided). */
    onsubmit?: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let { title, width = 440, oncancel, onsubmit, children, footer }: Props = $props();

  let panel = $state<HTMLDivElement | null>(null);

  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  $effect(() => {
    const el = panel;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button.primary");
    (first ?? el).focus();
    if (first instanceof HTMLInputElement && first.type === "text") first.select();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      oncancel();
      return;
    }
    if (e.key === "Enter" && onsubmit && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      e.stopPropagation();
      onsubmit();
      return;
    }
    if (e.key === "Tab" && panel) {
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    e.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onpointerdown={(e) => e.target === e.currentTarget && oncancel()} onkeydown={onkeydown}>
  <div class="panel" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={panel} style:width="{width}px">
    <header>
      <h2>{title}</h2>
      <button type="button" class="icon-btn" aria-label="Close" onclick={oncancel}><X size={14} /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    background: rgba(4, 6, 10, 0.55);
    backdrop-filter: blur(6px);
    animation: fade var(--t-fast) ease-out;
  }
  .panel {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--glass);
    backdrop-filter: blur(18px) saturate(140%);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2), 0 0 0 1px rgba(0, 0, 0, 0.5);
    outline: none;
    animation: rise var(--t-fast) ease-out;
  }
  header {
    display: flex;
    align-items: center;
    padding: 12px 12px 8px 16px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .body {
    padding: 4px 16px 12px;
    overflow: auto;
    font-size: var(--fs-sm);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--border);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .backdrop,
    .panel {
      animation: none;
    }
  }
</style>
