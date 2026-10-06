<script lang="ts">
  /** Shown over the canvas area when nothing is open. */
  import { FilePlus, FolderOpen, Clock } from "@lucide/svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { runCommand } from "./registry.svelte";
  import { openPaths } from "./commands/file";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";

  function shortName(p: string): string {
    return p.split(/[\\/]/).pop() ?? p;
  }
</script>

<div class="welcome">
  <div class="card">
    <span class="logo" aria-hidden="true"></span>
    <h1>Pixelforge</h1>
    <p class="tag">A raster editor with AI you can chain. Nothing is open yet.</p>
    <div class="actions">
      <button type="button" class="action" onclick={() => void runCommand("file.new")}>
        <FilePlus size={18} strokeWidth={1.75} />
        <span>New document</span>
        <kbd>{formatShortcut("CmdOrCtrl+N", IS_MAC)}</kbd>
      </button>
      <button type="button" class="action" onclick={() => void runCommand("file.open")}>
        <FolderOpen size={18} strokeWidth={1.75} />
        <span>Open image or project</span>
        <kbd>{formatShortcut("CmdOrCtrl+O", IS_MAC)}</kbd>
      </button>
    </div>
    {#if ui.recentFiles.length}
      <div class="recent">
        <div class="rh"><Clock size={12} /> Recent</div>
        {#each ui.recentFiles.slice(0, 6) as p (p)}
          <button type="button" class="r" title={p} onclick={() => void openPaths([p])}>
            <span class="rn">{shortName(p)}</span>
            <span class="rp">{p}</span>
          </button>
        {/each}
      </div>
    {/if}
    <p class="hint">Drop image files anywhere to open them. {formatShortcut("CmdOrCtrl+K", IS_MAC)} lists every command.</p>
  </div>
</div>

<style>
  .welcome {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background:
      radial-gradient(60% 50% at 50% 40%, rgba(139, 108, 255, 0.1), transparent 70%),
      var(--bg-0);
  }
  .card {
    width: 440px;
    max-width: calc(100% - 48px);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .logo {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
    box-shadow: 0 0 36px rgba(139, 108, 255, 0.45);
    margin-bottom: 18px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .tag {
    margin: 6px 0 22px;
    color: var(--fg-1);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
  .action {
    display: grid;
    grid-template-columns: 24px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    text-align: left;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    color: var(--fg-0);
    font-size: var(--fs-md);
    transition: border-color var(--t-fast) ease-out, background var(--t-fast) ease-out, box-shadow var(--t-fast) ease-out;
  }
  .action:hover {
    border-color: var(--accent);
    background: var(--bg-3);
    box-shadow: 0 0 0 1px rgba(139, 108, 255, 0.25), 0 0 20px rgba(139, 108, 255, 0.15);
  }
  kbd {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--fg-2);
  }
  .recent {
    width: 100%;
    margin-top: 18px;
    text-align: left;
  }
  .rh {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 6px 4px;
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .r {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 6px 10px;
    border-radius: var(--radius-md);
    text-align: left;
  }
  .r:hover {
    background: var(--bg-2);
  }
  .rn {
    color: var(--fg-0);
    font-size: var(--fs-sm);
  }
  .rp {
    color: var(--fg-2);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin: 22px 0 0;
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
</style>
