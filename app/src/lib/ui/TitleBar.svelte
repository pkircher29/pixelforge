<script lang="ts">
  /**
   * Custom title bar: brand, registry-driven menus, centred document title, window
   * controls. Drag regions carry `data-tauri-drag-region` on the element itself.
   */
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import MenuBar from "./MenuBar.svelte";

  interface Props {
    title?: string;
  }
  let { title = "Pixelforge" }: Props = $props();

  const inTauri = isTauri();
  const win = inTauri ? getCurrentWindow() : null;
  const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgent);

  let maximized = $state(false);

  $effect(() => {
    if (!win) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const sync = async () => {
      try {
        maximized = await win.isMaximized();
      } catch (err) {
        console.warn("isMaximized failed", err);
      }
    };
    void sync();
    win
      .onResized(() => void sync())
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => console.warn("onResized failed", err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  });

  $effect(() => {
    if (win) void win.setTitle(title).catch(() => {});
  });

  async function run(action: "minimize" | "toggleMaximize" | "close") {
    if (!win) return;
    try {
      await win[action]();
    } catch (err) {
      console.warn(`window.${action} failed`, err);
    }
  }
</script>

<header class="titlebar" class:mac={isMac} data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <span class="logo" data-tauri-drag-region aria-hidden="true"></span>
    <span class="name" data-tauri-drag-region>Pixelforge</span>
  </div>

  <MenuBar />

  <div class="title" data-tauri-drag-region>{title}</div>
  <div class="spacer" data-tauri-drag-region></div>

  {#if !isMac}
    <div class="controls">
      <button type="button" class="ctl" aria-label="Minimize" title="Minimize" onclick={() => run("minimize")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" /></svg>
      </button>
      <button
        type="button"
        class="ctl"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onclick={() => run("toggleMaximize")}
      >
        {#if maximized}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5h7v7h-7z M0.5 7.5v-7h7" fill="none" stroke="currentColor" />
          </svg>
        {:else}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5h9v9h-9z" fill="none" stroke="currentColor" />
          </svg>
        {/if}
      </button>
      <button type="button" class="ctl close" aria-label="Close" title="Close" onclick={() => run("close")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
      </button>
    </div>
  {/if}
</header>

<style>
  .titlebar {
    position: relative;
    display: flex;
    align-items: center;
    height: var(--titlebar-h);
    padding-left: 12px;
    background: linear-gradient(180deg, var(--bg-2) 0%, var(--bg-1) 100%);
    border-bottom: 1px solid var(--border);
    z-index: 50;
  }
  .titlebar.mac {
    padding-left: 84px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: 12px;
  }
  .logo {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
    box-shadow: 0 0 10px rgba(139, 108, 255, 0.5);
  }
  .name {
    font-weight: 600;
    font-size: var(--fs-md);
    letter-spacing: -0.01em;
    color: var(--fg-0);
  }
  .title {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: 34%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    color: var(--fg-2);
    pointer-events: none;
  }
  .spacer {
    flex: 1;
    height: 100%;
  }
  .controls {
    display: flex;
    height: 100%;
  }
  .ctl {
    width: 46px;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--fg-1);
    transition: background var(--t-fast) ease-out, color var(--t-fast) ease-out;
  }
  .ctl:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .ctl.close:hover {
    background: #e81123;
    color: #fff;
  }
</style>
