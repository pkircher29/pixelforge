<script lang="ts">
  import Icon from "./icons/Icon.svelte";
  import { toast } from "$lib/stores/toast.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each toast.items as t (t.id)}
    <div class="toast ps-popup {t.kind}" role="status">
      <span class="ic">
        <Icon name={t.kind === "success" ? "success" : t.kind === "error" ? "warning" : "info"} size={14} />
      </span>
      <span class="text">
        <span class="msg">{t.message}</span>
        {#if t.detail}<span class="detail">{t.detail}</span>{/if}
      </span>
      <button type="button" class="icon-btn" aria-label="Dismiss" onclick={() => toast.dismiss(t.id)}><Icon name="close-small" size={12} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 12px;
    bottom: calc(var(--statusbar-h) + 10px);
    /* Toasts stay visible over every dialog host (API keys dialog is 1000). */
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: 8px;
    min-width: 240px;
    max-width: 400px;
    padding: 7px 6px 7px 8px;
    font-size: var(--fs-sm);
    background: var(--ps-panel-head);
  }
  .ic {
    display: grid;
    place-items: center;
    margin-top: 1px;
    color: var(--ps-text-dim);
  }
  .error .ic {
    color: #ff8a8a;
  }
  .success .ic {
    color: #7fd3a8;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .msg {
    color: var(--ps-text);
  }
  .detail {
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
    word-break: break-word;
  }
</style>
