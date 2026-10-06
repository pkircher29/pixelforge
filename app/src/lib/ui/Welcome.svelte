<script lang="ts">
  /** Shown on the pasteboard when nothing is open: a quiet PS-coloured start panel. */
  import Icon from "./icons/Icon.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { runCommand } from "./registry.svelte";
  import { openPaths } from "./commands/file";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";

  function shortName(p: string): string {
    return p.split(/[\\/]/).pop() ?? p;
  }
  function dir(p: string): string {
    return p.replace(/[\\/][^\\/]*$/, "");
  }
</script>

<div class="welcome">
  <div class="card">
    <div class="head">
      <span class="mark" aria-hidden="true"><Icon name="app-mark" size={16} /></span>
      <span class="name">Pixelforge</span>
    </div>
    <div class="actions">
      <button type="button" class="action" onclick={() => void runCommand("file.new")}>
        <Icon name="document-new" size={16} />
        <span>New…</span>
        <kbd>{formatShortcut("CmdOrCtrl+N", IS_MAC)}</kbd>
      </button>
      <button type="button" class="action" onclick={() => void runCommand("file.open")}>
        <Icon name="folder-open" size={16} />
        <span>Open…</span>
        <kbd>{formatShortcut("CmdOrCtrl+O", IS_MAC)}</kbd>
      </button>
    </div>
    <div class="recent">
      <div class="rh">Recent</div>
      {#if ui.recentFiles.length}
        <div class="rlist">
          {#each ui.recentFiles.slice(0, 8) as p (p)}
            <button type="button" class="r" title={p} onclick={() => void openPaths([p])}>
              <Icon name="image" size={14} />
              <span class="rn">{shortName(p)}</span>
              <span class="rp">{dir(p)}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="rempty">Files you open will be listed here. Drop an image anywhere to open it.</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .welcome {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--ps-canvas-bg);
  }
  .card {
    width: 460px;
    max-width: calc(100% - 48px);
    background: var(--ps-app);
    border: 1px solid var(--ps-border-dark);
    box-shadow:
      inset 0 0 0 1px var(--ps-border-light),
      0 6px 20px rgba(0, 0, 0, 0.45);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    background: var(--ps-panel-head);
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    background: var(--ps-accent);
    border-radius: 2px;
    color: #fff;
  }
  .name {
    font-size: var(--fs-lg);
    color: var(--ps-text);
  }
  .actions {
    display: flex;
    gap: 8px;
    padding: 14px 12px 10px;
  }
  .action {
    flex: 1;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    text-align: left;
    background: var(--ps-button);
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    color: var(--ps-text);
  }
  .action:hover {
    background: var(--ps-button-hover);
  }
  kbd {
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .recent {
    padding: 4px 12px 12px;
  }
  .rh {
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
    padding: 4px 0;
    border-bottom: 1px solid var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
    margin-bottom: 4px;
  }
  .rlist {
    display: flex;
    flex-direction: column;
    max-height: 200px;
    overflow: auto;
  }
  .r {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: 8px;
    height: var(--row-h);
    padding: 0 6px;
    text-align: left;
    color: var(--ps-text-dim);
  }
  .r:hover {
    background: var(--ps-row-selected);
    color: var(--ps-text);
  }
  .rn {
    color: var(--ps-text);
  }
  .rp {
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rempty {
    padding: 8px 0 2px;
    color: var(--ps-text-disabled);
    font-size: var(--fs-sm);
  }
</style>
