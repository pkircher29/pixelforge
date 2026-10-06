<script lang="ts">
  /** Right dock placeholder: Layers / History / AI panels arrive in wave 3. */
  interface Section {
    id: string;
    title: string;
    hint: string;
  }

  const sections: Section[] = [
    { id: "layers", title: "Layers", hint: "Blend modes, opacity, groups" },
    { id: "history", title: "History", hint: "Unlimited undo, click to jump" },
    { id: "ai", title: "AI", hint: "ChatGPT / Grok / Gemini - generate, mask edit, instruct" },
  ];

  let open = $state<Record<string, boolean>>({ layers: true, history: true, ai: true });

  function toggle(id: string) {
    open = { ...open, [id]: !open[id] };
  }
</script>

<aside class="panel" aria-label="Panels">
  {#each sections as s (s.id)}
    <section class="section" class:collapsed={!open[s.id]}>
      <button type="button" class="head" onclick={() => toggle(s.id)} aria-expanded={open[s.id] ?? false}>
        <span class="chev" aria-hidden="true">{open[s.id] ? "▾" : "▸"}</span>
        <span class="title">{s.title}</span>
      </button>
      {#if open[s.id]}
        <div class="body">
          <p class="hint">{s.hint}</p>
          {#if s.id === "layers"}
            <div class="row">
              <span class="thumb"></span>
              <span class="label">Background</span>
            </div>
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border-left: 1px solid var(--border);
    overflow-y: auto;
  }

  .section {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--border);
  }
  .section:not(.collapsed) {
    flex: 1 1 0;
    min-height: 120px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 10px;
    text-align: left;
    background: var(--bg-2);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--fg-1);
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }
  .head:hover {
    color: var(--fg-0);
  }
  .chev {
    width: 10px;
    color: var(--fg-2);
  }

  .body {
    padding: 8px 10px;
    font-size: var(--fs-sm);
  }

  .hint {
    margin: 0 0 8px;
    color: var(--fg-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px rgba(124, 92, 255, 0.35);
  }
  .thumb {
    width: 28px;
    height: 20px;
    border-radius: 2px;
    background:
      linear-gradient(45deg, #777 25%, transparent 25%, transparent 75%, #777 75%),
      linear-gradient(45deg, #777 25%, #bbb 25%, #bbb 75%, #777 75%);
    background-size: 6px 6px;
    background-position: 0 0, 3px 3px;
  }
  .label {
    color: var(--fg-0);
  }
</style>
