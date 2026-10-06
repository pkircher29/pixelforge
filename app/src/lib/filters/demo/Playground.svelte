<script lang="ts">
  /**
   * Dev-only playground: a real document in `docStore`, a compositor canvas that mimics
   * the shell's (`aria-label="Document canvas"`), and one button per registered command
   * from `$lib/filters/register`. Lets the dialogs, live preview and Free Transform be
   * exercised without the shell.
   */
  import { onMount } from "svelte";
  import { createCompositor, Rect, Selection, type ICompositor } from "$lib/engine";
  import { buildDemoDocument } from "$lib/engine/demo/demo";
  import { docStore } from "$lib/stores/doc.svelte";
  import { getCommands, runCommand } from "$lib/ui/registry.svelte";
  import { transformSession } from "$lib/filters/transform/session.svelte";
  import { rawDoc } from "$lib/filters/raw";
  import "$lib/filters/register";

  // Debug handle for scripted verification (CDP): `window.__pf`.
  (window as unknown as { __pf: unknown }).__pf = { docStore, transformSession, runCommand, rawDoc };

  let canvas = $state<HTMLCanvasElement | null>(null);
  let compositor: ICompositor | null = null;

  const commands = $derived(getCommands().filter((c) => c.menu));
  const groups = $derived.by(() => {
    const m = new Map<string, typeof commands>();
    for (const c of commands) {
      const k = c.menu!;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return [...m.entries()].map(([menu, cmds]) => ({ menu, cmds: cmds.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }));
  });

  onMount(() => {
    const doc = buildDemoDocument();
    doc.selection = Selection.none(doc.width, doc.height);
    doc.activeLayerId = doc.layers[0]!.id;
    const entry = docStore.open(doc, null);
    const el = canvas!;
    compositor = createCompositor(el);
    entry.compositor = compositor;
    let raf = 0;
    let fitted = false;
    let phase = 0;
    const frame = (t: number): void => {
      const dpr = window.devicePixelRatio || 1;
      const r = el.getBoundingClientRect();
      if (!fitted) {
        entry.viewport.fitToView(r.width, r.height, doc.width, doc.height, 40);
        fitted = true;
      }
      phase = (t / 60) % 8;
      compositor!.render(doc, entry.viewport, {
        width: Math.round(r.width * dpr),
        height: Math.round(r.height * dpr),
        dpr,
        antsPhase: phase,
        activeLayerId: doc.activeLayerId,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      compositor?.dispose();
    };
  });

  // Writes go to the raw document (see $lib/filters/raw.ts), never through the store proxy.
  function selectEllipse(): void {
    const e = docStore.active;
    if (!e) return;
    const d = rawDoc(e);
    d.selection = Selection.fromEllipse(d.width, d.height, Rect.make(140, 120, 260, 220));
    docStore.touch();
  }
  function deselect(): void {
    const e = docStore.active;
    if (!e) return;
    const d = rawDoc(e);
    d.selection = Selection.none(d.width, d.height);
    docStore.touch();
  }
  function pickLayer(e: Event): void {
    docStore.setActiveLayer((e.currentTarget as HTMLSelectElement).value);
  }
</script>

<div class="pg">
  <aside>
    <h3>Playground</h3>
    <label>
      Layer
      <select onchange={pickLayer}>
        {#each docStore.doc?.layers ?? [] as l (l.id)}
          <option value={l.id} selected={l.id === docStore.doc?.activeLayerId}>{l.name}</option>
        {/each}
      </select>
    </label>
    <div class="row">
      <button onclick={selectEllipse}>Select ellipse</button>
      <button onclick={deselect}>Deselect</button>
      <button onclick={() => docStore.undo()}>Undo</button>
      <button onclick={() => docStore.redo()}>Redo</button>
    </div>
    {#each groups as g (g.menu)}
      <h4>{g.menu}</h4>
      <div class="row">
        {#each g.cmds as c (c.id)}
          <button onclick={() => void runCommand(c.id)} disabled={c.enabled ? !c.enabled() : false} title="{c.id} {c.shortcut ?? ''}">
            {c.label}
          </button>
        {/each}
      </div>
    {/each}
    <p class="mono">history: {docStore.active?.history.entries.map((e) => e.label).join(" › ") ?? ""}</p>
  </aside>
  <main>
    <canvas bind:this={canvas} aria-label="Document canvas"></canvas>
  </main>
</div>

<style>
  .pg {
    display: grid;
    grid-template-columns: 300px 1fr;
    height: 100%;
    color: var(--fg-0);
    font-size: var(--fs-sm);
  }
  aside {
    padding: 12px;
    overflow: auto;
    background: var(--bg-1);
    border-right: 1px solid var(--border);
  }
  h3 {
    margin: 0 0 8px;
    font-size: var(--fs-md);
  }
  h4 {
    margin: 12px 0 4px;
    font-size: var(--fs-xs);
    color: var(--fg-2);
    font-weight: 600;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  button {
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
  }
  button:disabled {
    opacity: 0.4;
  }
  select {
    font: inherit;
    color: inherit;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    margin-left: 6px;
  }
  main {
    position: relative;
    min-width: 0;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--fg-2);
    word-break: break-word;
  }
</style>
