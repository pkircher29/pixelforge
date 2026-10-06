<script lang="ts">
  /**
   * PS-style single-row title bar: app mark, menus, centred document title, window
   * controls. Drag regions carry `data-tauri-drag-region` on the element itself.
   */
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import MenuBar from "./MenuBar.svelte";
  import Icon from "./icons/Icon.svelte";

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
  <div class="brand" data-tauri-drag-region title="Pixelforge">
    <span class="mark" data-tauri-drag-region aria-hidden="true"><Icon name="app-mark" size={14} /></span>
  </div>

  <MenuBar />

  <div class="title" data-tauri-drag-region>{title}</div>
  <div class="spacer" data-tauri-drag-region></div>

  {#if !isMac}
    <div class="controls">
      <button type="button" class="ctl" aria-label="Minimize" title="Minimize" onclick={() => run("minimize")}>
        <Icon name="window-min" size={16} />
      </button>
      <button type="button" class="ctl" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onclick={() => run("toggleMaximize")}>
        <Icon name={maximized ? "window-restore" : "window-max"} size={16} />
      </button>
      <button type="button" class="ctl close" aria-label="Close" title="Close" onclick={() => run("close")}>
        <Icon name="window-close" size={16} />
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
    padding-left: 6px;
    background: var(--ps-app);
    border-bottom: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 -1px 0 var(--ps-border-light);
    z-index: 50;
  }
  .titlebar.mac {
    padding-left: 78px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 100%;
    padding: 0 6px 0 2px;
    margin-right: 2px;
    border-right: 1px solid var(--ps-border-dark);
    box-shadow: 1px 0 0 var(--ps-border-light);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    background: var(--ps-accent);
    border-radius: 2px;
    color: #fff;
  }
  .name {
    font-weight: 600;
    font-size: var(--fs-sm);
    color: var(--ps-text);
    letter-spacing: 0.02em;
  }
  .title {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: 36%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    color: var(--ps-text-dim);
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
    width: 44px;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--ps-text-dim);
  }
  .ctl:hover {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .ctl.close:hover {
    background: #c42b1c;
    color: #fff;
  }
</style>
