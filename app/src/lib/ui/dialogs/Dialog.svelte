<script lang="ts">
  /**
   * PS modal dialog: #3c3c3c title bar, 1px border, OK/Cancel right-aligned in the footer.
   * Esc cancels, Enter submits (unless focus is in a textarea), Tab is trapped inside,
   * first field is focused. Draggable by the title bar.
   */
  import type { Snippet } from "svelte";
  import Icon from "../icons/Icon.svelte";

  interface Props {
    title: string;
    width?: number;
    /** Called on Esc / close button. */
    oncancel: () => void;
    /** Called on Enter (when provided). */
    onsubmit?: () => void;
    children: Snippet;
    footer?: Snippet;
    /** Dim the app behind (default true; filters' live previews pass false). */
    dim?: boolean;
  }

  let { title, width = 440, oncancel, onsubmit, children, footer, dim = true }: Props = $props();

  let panel = $state<HTMLDivElement | null>(null);
  let dx = $state(0);
  let dy = $state(0);

  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  $effect(() => {
    const el = panel;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("[data-autofocus], input:not([type=checkbox]):not([type=radio]), select, textarea, button.primary");
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

  function startDrag(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = e.currentTarget as HTMLElement;
    const sx = e.clientX - dx;
    const sy = e.clientY - dy;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      dx = ev.clientX - sx;
      dy = ev.clientY - sy;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" class:dim onpointerdown={(e) => e.target === e.currentTarget && oncancel()} onkeydown={onkeydown}>
  <div class="panel" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={panel} style:width="{width}px" style:left="{dx}px" style:top="{dy}px">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header onpointerdown={startDrag}>
      <h2>{title}</h2>
      <button type="button" class="x" aria-label="Close" onclick={oncancel}><Icon name="close-small" size={12} /></button>
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
    /* Above the Free Transform overlay (800) and the filters' live-preview dialogs (900). */
    z-index: 950;
    display: grid;
    place-items: center;
  }
  .backdrop.dim {
    background: rgba(0, 0, 0, 0.35);
  }
  .panel {
    /* Dragged with left/top, not transform: a transform would become the containing
       block of position:fixed dropdowns (PsSelect) and clip them inside the body. */
    position: relative;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--ps-app);
    border: 1px solid var(--ps-border-dark);
    box-shadow:
      inset 0 0 0 1px var(--ps-border-light),
      0 8px 24px rgba(0, 0, 0, 0.6);
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    height: 26px;
    padding: 0 4px 0 10px;
    margin: 1px 1px 0;
    background: var(--ps-panel-head);
    border-bottom: 1px solid var(--ps-border-dark);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 400;
    color: var(--ps-text);
  }
  .x {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    color: var(--ps-text-dim);
    border-radius: 2px;
  }
  .x:hover {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .body {
    padding: 12px 14px 10px;
    overflow: auto;
    font-size: var(--fs-sm);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 8px 14px 12px;
  }
  footer :global(.btn) {
    min-width: 72px;
  }
</style>
