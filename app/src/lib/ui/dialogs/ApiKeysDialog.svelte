<script lang="ts">
  /**
   * AI API keys: one row per provider with a password field, test, save, delete, and a
   * link to the vendor console. Mounted on `document.body` by `$lib/ai/dialogs`.
   *
   * TODO(shell): rebuild on the shared dialog primitive once `lib/ui/dialogs/Dialog.svelte`
   * exists; the overlay + focus trap here is intentionally minimal.
   */
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { Check, CircleAlert, ExternalLink, Eye, LoaderCircle, Trash, X } from "@lucide/svelte";
  import { deleteKey, getKeyStatus, hasTauri, listProviders, setKey, testKey } from "$lib/ai/client";
  import { toFriendlyError } from "$lib/ai/errors";
  import { PROVIDER_CONSOLE_URL, PROVIDER_IDS, PROVIDER_LABEL, PROVIDER_VENDOR, type ProviderId } from "$lib/ai/types";

  interface Props {
    onclose: () => void;
  }
  const { onclose }: Props = $props();

  interface Row {
    id: ProviderId;
    name: string;
    vendor: string;
    hasKey: boolean;
    value: string;
    show: boolean;
    busy: "" | "test" | "save" | "delete";
    result: { ok: boolean; text: string } | null;
  }

  let rows = $state<Row[]>(
    PROVIDER_IDS.map((id) => ({ id, name: PROVIDER_LABEL[id], vendor: PROVIDER_VENDOR[id], hasKey: false, value: "", show: false, busy: "", result: null })),
  );
  let backend = $state<"keyring" | "file" | null>(null);
  let panel = $state<HTMLDivElement | null>(null);

  async function refresh(): Promise<void> {
    if (!hasTauri()) return;
    try {
      const [status, providers] = await Promise.all([getKeyStatus(), listProviders()]);
      for (const r of rows) r.hasKey = status[r.id] ?? false;
      backend = providers[0]?.keyBackend ?? null;
    } catch (e) {
      const f = toFriendlyError(e);
      for (const r of rows) r.result = { ok: false, text: f.title };
    }
  }

  onMount(() => {
    void refresh();
    panel?.querySelector<HTMLElement>("input, button")?.focus();
  });

  async function save(r: Row): Promise<void> {
    r.busy = "save";
    r.result = null;
    try {
      await setKey(r.id, r.value);
      r.value = "";
      r.hasKey = true;
      r.result = { ok: true, text: "Saved. Test it to be sure." };
    } catch (e) {
      r.result = { ok: false, text: toFriendlyError(e).detail };
    } finally {
      r.busy = "";
    }
  }

  async function test(r: Row): Promise<void> {
    r.busy = "test";
    r.result = null;
    try {
      if (r.value.trim()) {
        await setKey(r.id, r.value);
        r.value = "";
        r.hasKey = true;
      }
      await testKey(r.id);
      r.result = { ok: true, text: `${r.vendor} accepted the key.` };
    } catch (e) {
      const f = toFriendlyError(e);
      r.result = { ok: false, text: f.code === "ai_auth" ? `${r.vendor} rejected the key. ${f.detail}` : `${f.title} ${f.detail}` };
    } finally {
      r.busy = "";
    }
  }

  async function remove(r: Row): Promise<void> {
    r.busy = "delete";
    r.result = null;
    try {
      await deleteKey(r.id);
      r.hasKey = false;
      r.value = "";
      r.result = { ok: true, text: "Key removed." };
    } catch (e) {
      r.result = { ok: false, text: toFriendlyError(e).detail };
    } finally {
      r.busy = "";
    }
  }

  function open(url: string): void {
    if (hasTauri()) void openUrl(url).catch(() => window.open(url, "_blank"));
    else window.open(url, "_blank");
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="apikeys-title" bind:this={panel}>
    <header>
      <h2 id="apikeys-title">AI API keys</h2>
      <button type="button" class="icon" aria-label="Close" onclick={onclose}><X size={16} /></button>
    </header>

    <p class="lead">
      Pixelforge calls each vendor's image API directly with your own key. ChatGPT Plus, SuperGrok and Google AI Pro subscriptions do not cover API use; each vendor bills
      API calls separately. Signing in with a ChatGPT account is planned for a later release.
    </p>

    {#each rows as r (r.id)}
      <section class="row">
        <div class="title">
          <span class="dot" class:ok={r.hasKey}></span>
          <span class="name">{r.name}</span>
          <span class="vendor">{r.vendor}</span>
          <button type="button" class="link" onclick={() => open(PROVIDER_CONSOLE_URL[r.id])}>
            Get a key <ExternalLink size={11} />
          </button>
        </div>
        <div class="input">
          <input
            type={r.show ? "text" : "password"}
            bind:value={r.value}
            placeholder={r.hasKey ? "Key saved; paste a new one to replace it" : `Paste your ${r.vendor} API key`}
            autocomplete="off"
            spellcheck="false"
            aria-label="{r.vendor} API key"
            onkeydown={(e) => e.key === "Enter" && r.value.trim() && void save(r)}
          />
          <button type="button" class="icon" title={r.show ? "Hide" : "Show"} aria-label={r.show ? "Hide key" : "Show key"} onclick={() => (r.show = !r.show)}><Eye size={14} /></button>
        </div>
        <div class="actions">
          <button type="button" class="btn primary" disabled={!r.value.trim() || r.busy !== ""} onclick={() => void save(r)}>
            {#if r.busy === "save"}<LoaderCircle size={12} class="spin" />{/if} Save
          </button>
          <button type="button" class="btn" disabled={(!r.hasKey && !r.value.trim()) || r.busy !== ""} onclick={() => void test(r)}>
            {#if r.busy === "test"}<LoaderCircle size={12} class="spin" />{/if} Test
          </button>
          <button type="button" class="btn danger" disabled={!r.hasKey || r.busy !== ""} onclick={() => void remove(r)}>
            <Trash size={12} /> Delete
          </button>
          {#if r.result}
            <span class="result" class:ok={r.result.ok} class:bad={!r.result.ok}>
              {#if r.result.ok}<Check size={13} />{:else}<CircleAlert size={13} />{/if}
              {r.result.text}
            </span>
          {/if}
        </div>
      </section>
    {/each}

    <footer>
      {#if backend === "keyring"}
        Keys are stored in the OS keychain and never shown again.
      {:else if backend === "file"}
        No OS keychain is available: keys are kept in a local file, obfuscated but not encrypted.
      {:else}
        Keys are stored in the OS keychain where available, otherwise in an obfuscated local file.
      {/if}
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background: rgba(5, 7, 12, 0.6);
    backdrop-filter: blur(2px);
  }
  .dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px 14px;
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-2);
    color: var(--fg-1);
    font-size: var(--fs-sm);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--fg-0);
  }
  .lead {
    margin: 0;
    line-height: 1.5;
    color: var(--fg-1);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-2);
  }
  .dot.ok {
    background: #43d17a;
    box-shadow: 0 0 6px rgba(67, 209, 122, 0.6);
  }
  .name {
    font-weight: 600;
    color: var(--fg-0);
  }
  .vendor {
    color: var(--fg-2);
  }
  .link {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent-2);
    font-size: var(--fs-xs);
  }
  .link:hover {
    text-decoration: underline;
  }
  .input {
    display: flex;
    gap: 4px;
  }
  input {
    flex: 1;
    font: inherit;
    font-family: var(--font-mono);
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    user-select: text;
    -webkit-user-select: text;
  }
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .icon {
    display: inline-flex;
    padding: 4px;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
  }
  .icon:hover {
    color: var(--fg-0);
    background: var(--bg-3);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-3);
    color: var(--fg-1);
  }
  .btn:hover:not(:disabled) {
    color: var(--fg-0);
  }
  .btn:disabled {
    opacity: 0.4;
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
  }
  .btn.danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .result {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
  }
  .result.ok {
    color: #43d17a;
  }
  .result.bad {
    color: var(--danger);
  }
  footer {
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  :global(.dialog .spin) {
    animation: keys-spin 0.9s linear infinite;
  }
  @keyframes keys-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.dialog .spin) {
      animation: none;
    }
  }
</style>
