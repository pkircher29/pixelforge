<script lang="ts">
  import { CheckCircle, AlertCircle, Info, X } from "@lucide/svelte";
  import { toast } from "$lib/stores/toast.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each toast.items as t (t.id)}
    <div class="toast glass {t.kind}" role="status">
      <span class="ic">
        {#if t.kind === "success"}<CheckCircle size={15} />{:else if t.kind === "error"}<AlertCircle size={15} />{:else}<Info size={15} />{/if}
      </span>
      <span class="text">
        <span class="msg">{t.message}</span>
        {#if t.detail}<span class="detail">{t.detail}</span>{/if}
      </span>
      <button type="button" class="icon-btn" aria-label="Dismiss" onclick={() => toast.dismiss(t.id)}><X size={12} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: calc(var(--statusbar-h) + 12px);
    /* Toasts stay visible over every dialog host (API keys dialog is 1000). */
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: 10px;
    min-width: 260px;
    max-width: 420px;
    padding: 10px 10px 10px 12px;
    font-size: var(--fs-sm);
    animation: slide var(--t-mid) ease-out;
  }
  .ic {
    display: grid;
    place-items: center;
    margin-top: 1px;
  }
  .success .ic {
    color: var(--ok);
  }
  .error .ic {
    color: var(--danger);
  }
  .info .ic {
    color: var(--accent-2);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .msg {
    color: var(--fg-0);
  }
  .detail {
    color: var(--fg-2);
    font-size: var(--fs-xs);
    word-break: break-word;
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateX(10px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
