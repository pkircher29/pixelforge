<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { isTauri } from "@tauri-apps/api/core";
  import { APP_VERSION } from "$lib/io/files";

  interface Props {
    compositor: string;
    resolve: Resolver<void>;
  }
  let { compositor, resolve }: Props = $props();
  const repo = "https://github.com/pkircher29/pixelforge";

  function open(url: string) {
    if (isTauri()) void openUrl(url);
    else window.open(url, "_blank", "noopener");
  }
</script>

<Dialog title="About Pixelforge" width={400} oncancel={() => resolve(null)} onsubmit={() => resolve(null)}>
  <div class="about">
    <span class="logo" aria-hidden="true"></span>
    <div>
      <div class="name">Pixelforge <span class="ver">v{APP_VERSION}</span></div>
      <p>Open-source raster editor with chainable AI (ChatGPT, Grok, Gemini) using your own keys.</p>
      <p class="tech">Tauri 2 · Svelte 5 · Rust · compositor: {compositor}</p>
      <p class="links">
        <button type="button" class="link" onclick={() => open(repo)}>GitHub</button>
        <button type="button" class="link" onclick={() => open(`${repo}/issues`)}>Report a problem</button>
        <button type="button" class="link" onclick={() => open(`${repo}/blob/main/LICENSE`)}>MIT license</button>
      </p>
    </div>
  </div>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={() => resolve(null)}>Close</button>
  {/snippet}
</Dialog>

<style>
  .about {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 4px 0;
  }
  .logo {
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
    box-shadow: 0 0 24px rgba(139, 108, 255, 0.45);
  }
  .name {
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .ver {
    margin-left: 6px;
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 400;
  }
  p {
    margin: 6px 0;
    color: var(--fg-1);
    line-height: 1.5;
  }
  .tech {
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .links {
    display: flex;
    gap: 14px;
  }
  .link {
    color: var(--accent-2);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
