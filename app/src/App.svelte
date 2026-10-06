<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import TitleBar from "./lib/ui/TitleBar.svelte";
  import Toolbar from "./lib/ui/Toolbar.svelte";
  import OptionsBar from "./lib/ui/OptionsBar.svelte";
  import DocTabs from "./lib/ui/DocTabs.svelte";
  import CanvasView from "./lib/ui/CanvasView.svelte";
  import Dock from "./lib/ui/Dock.svelte";
  import StatusBar from "./lib/ui/StatusBar.svelte";
  import CommandPalette from "./lib/ui/CommandPalette.svelte";
  import ContextMenu from "./lib/ui/ContextMenu.svelte";
  import Toast from "./lib/ui/Toast.svelte";
  import Welcome from "./lib/ui/Welcome.svelte";
  import DialogHost from "./lib/ui/dialogs/DialogHost.svelte";
  import ContactSheet from "./lib/ui/icons/ContactSheet.svelte";
  import { docStore } from "./lib/stores/doc.svelte";
  import { ui } from "./lib/stores/ui.svelte";
  import { settings } from "./lib/stores/settings.svelte";
  import { toolStore } from "./lib/stores/tool.svelte";
  import { toast } from "./lib/stores/toast.svelte";
  import { getCommands, getPanels } from "./lib/ui/registry.svelte";
  import { installShortcuts } from "./lib/shortcuts";
  import { canvasHost } from "./lib/ui/canvas/host.svelte";
  import { contextMenu } from "./lib/ui/context-menu.svelte";
  import { recentList } from "./lib/io/files";
  import { openPaths, syncRecentCommands } from "./lib/ui/commands";
  import { syncWindowPanelCommands } from "./lib/ui/shell-commands";
  import { docTitle } from "./lib/ui/doc-title";
  import "./lib/ui/panels/register";

  // Feature modules from the other agents plug in through the registry only.
  void import("$lib/ai/register").catch(() => {});
  void import("$lib/filters/register").catch(() => {});

  const iconSheet = import.meta.env.DEV && new URLSearchParams(location.search).has("icons");

  const entry = $derived(docStore.active);
  const title = $derived.by(() => {
    if (!entry) return "Pixelforge";
    void entry.version;
    return docTitle(entry, { dirtyMark: true });
  });
  const fullscreen = $derived(toolStore.screenMode === "fullscreen");
  const menuOnly = $derived(toolStore.screenMode === "fullscreen-menu");

  // The registry is itself $state: register inside `untrack` so these effects depend only
  // on their inputs (recent files / panel list) and not on the commands they write.
  $effect(() => {
    const paths = ui.recentFiles.slice();
    untrack(() => syncRecentCommands(paths));
  });
  $effect(() => {
    void getPanels().length;
    untrack(() => syncWindowPanelCommands());
  });
  // Theme → <html data-theme>.
  $effect(() => {
    document.documentElement.dataset.theme = settings.value.theme;
  });

  onMount(() => {
    void settings.load().then((s) => {
      const mb = s.historyBudgetMb;
      for (const d of docStore.docs) d.history.budgetBytes = mb * 1048576;
    });
    void recentList();

    if (docStore.docs.length === 0) {
      const e = docStore.create({ name: "Untitled-1", width: 1920, height: 1080, background: "white" });
      e.dirty = false;
      e.doc.dirty = false;
    }
    canvasHost.activateTool(toolStore.activeToolId);

    const uninstall = installShortcuts({
      commands: () => getCommands(),
      toolKey: (e) => canvasHost.handleToolKey(e),
      toolEvent: (e, phase) => canvasHost.forwardKey(e, phase),
      modalOpen: () => ui.modalOpen || ui.paletteOpen,
      escape: () => {
        if (contextMenu.state) contextMenu.close();
        else canvasHost.cancelTool();
      },
    });

    let unlistenDrop: (() => void) | undefined;
    if (isTauri()) {
      getCurrentWebview()
        .onDragDropEvent((ev) => {
          if (ev.payload.type === "drop" && ev.payload.paths.length) void openPaths(ev.payload.paths);
        })
        .then((fn) => (unlistenDrop = fn))
        .catch((err: unknown) => console.warn("onDragDropEvent failed", err));
    }

    const onError = (ev: ErrorEvent) => toast.error("Something went wrong", ev.message);
    const onRejection = (ev: PromiseRejectionEvent) => {
      const r = ev.reason as { message?: string } | string | undefined;
      toast.error("Something went wrong", typeof r === "string" ? r : (r?.message ?? String(r)));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      uninstall();
      unlistenDrop?.();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  });

  // Apply the undo budget to documents opened later.
  $effect(() => {
    const mb = settings.value.historyBudgetMb;
    for (const d of docStore.docs) d.history.budgetBytes = mb * 1048576;
  });
</script>

{#if iconSheet}
  <ContactSheet />
{:else}
  <div class="app" class:fullscreen class:menu-only={menuOnly}>
    {#if !fullscreen}
      <TitleBar {title} />
    {/if}

    <div class="workspace">
      {#if !fullscreen}
        <Toolbar />
      {/if}

      <main class="center">
        {#if !fullscreen}
          <OptionsBar />
          {#if !menuOnly}
            <DocTabs />
          {/if}
        {/if}
        <div class="canvas-area">
          {#each docStore.docs as d (d.id)}
            <CanvasView entry={d} active={d.id === docStore.activeId} />
          {/each}
          {#if docStore.docs.length === 0}
            <Welcome />
          {/if}
        </div>
      </main>

      {#if !fullscreen && !menuOnly}
        <Dock />
      {/if}
    </div>

    {#if !fullscreen && !menuOnly}
      <StatusBar />
    {/if}
  </div>
{/if}

<CommandPalette />
<ContextMenu />
<DialogHost />
<Toast />

<style>
  .app {
    display: grid;
    grid-template-rows: var(--titlebar-h) 1fr var(--statusbar-h);
    height: 100%;
    background: var(--ps-app);
  }
  .app.menu-only {
    grid-template-rows: var(--titlebar-h) 1fr;
  }
  .app.fullscreen {
    grid-template-rows: 1fr;
  }
  .workspace {
    display: grid;
    grid-template-columns: var(--toolbar-w) 1fr auto;
    min-height: 0;
  }
  .workspace:has(> .center:first-child) {
    grid-template-columns: 1fr;
  }
  .menu-only .workspace {
    grid-template-columns: var(--toolbar-w) 1fr;
  }
  .center {
    display: grid;
    grid-template-rows: var(--optionsbar-h) var(--tabs-h) 1fr;
    min-width: 0;
    min-height: 0;
  }
  .menu-only .center {
    grid-template-rows: var(--optionsbar-h) 1fr;
  }
  .fullscreen .center {
    grid-template-rows: 1fr;
  }
  .canvas-area {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--ps-canvas-bg);
  }
</style>
