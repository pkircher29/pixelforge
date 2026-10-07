<script lang="ts">
  /**
   * Self-contained floating dialog for the filters module.
   *
   * TODO(integration): swap for the shell's Dialog primitive once `ui-shell-tools` lands
   * it; keep the `title / onclose / children / footer` props so callers don't change.
   *
   * Non-dimming by design: the live preview on the canvas must stay fully visible, so the
   * backdrop only swallows pointer events. The panel is draggable by its title bar and
   * opens towards the right of the window where it covers the least canvas.
   */
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    onclose: () => void;
    width?: number;
    children: Snippet;
    footer?: Snippet;
  }

  let { title, onclose, width = 360, children, footer }: Props = $props();

  let panel = $state<HTMLDivElement | null>(null);
  let x = $state(0);
  let y = $state(0);
  let placed = $state(false);

  $effect(() => {
    const el = panel;
    if (!el || placed) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // PS opens adjustment dialogs centred on the window (left of the panel dock so the
    // canvas preview stays visible).
    x = Math.max(12, Math.round((vw - 300 - r.width) / 2));
    y = Math.max(52, Math.round((vh - r.height) / 3));
    placed = true;
  });

  let drag: { dx: number; dy: number } | null = null;
  function onTitleDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    drag = { dx: e.clientX - x, dy: e.clientY - y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onTitleMove(e: PointerEvent): void {
    if (!drag) return;
    x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
    y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
  }
  function onTitleUp(): void {
    drag = null;
  }
</script>

<div class="backdrop" role="presentation"></div>
<div
  class="panel"
  bind:this={panel}
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
  style:width="{width}px"
  style:left="{x}px"
  style:top="{y}px"
  style:visibility={placed ? "visible" : "hidden"}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -- drag handle only; the close button is the interactive control -->
  <div
    class="title"
    onpointerdown={onTitleDown}
    onpointermove={onTitleMove}
    onpointerup={onTitleUp}
    onpointercancel={onTitleUp}
  >
    <span class="title-text">{title}</span>
    <button class="close" type="button" aria-label="Close" onclick={onclose}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
  <div class="body">
    {@render children()}
  </div>
  {#if footer}
    <div class="footer">
      {@render footer()}
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    background: transparent;
  }
  .panel {
    position: fixed;
    z-index: 901;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 24px);
    /* Same chrome as the shell's PS dialogs (Dialog.svelte): flat, square, hairlines. */
    background: var(--ps-app);
    border: 1px solid var(--ps-border-dark);
    box-shadow:
      inset 0 0 0 1px var(--ps-border-light),
      0 8px 24px rgba(0, 0, 0, 0.6);
    color: var(--ps-text);
    font-size: var(--fs-sm);
    outline: none;
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    padding: 0 4px 0 10px;
    margin: 1px 1px 0;
    background: var(--ps-panel-head);
    border-bottom: 1px solid var(--ps-border-dark);
    cursor: default;
    touch-action: none;
  }
  .title-text {
    font-size: var(--fs-sm);
    font-weight: 400;
  }
  .close {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .close:hover {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .body {
    padding: 12px 14px 10px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px 12px;
  }
  .footer :global(.btn) {
    min-width: 72px;
  }</style>
