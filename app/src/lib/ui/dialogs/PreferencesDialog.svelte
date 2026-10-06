<script lang="ts">
  /**
   * Preferences — PS layout: category list on the left, page on the right, OK/Cancel.
   * Changes apply live (theme, transparency grid) and are reverted on Cancel.
   */
  import { untrack } from "svelte";
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { settings, DEFAULT_SETTINGS, type Settings, type ThemeId } from "$lib/stores/settings.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { recentClear } from "$lib/io/files";
  import { runCommand, getCommand } from "$lib/ui/registry.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";

  interface Props {
    resolve: Resolver<void>;
    page?: string;
  }
  let { resolve, page = "general" }: Props = $props();

  const CATEGORIES = [
    { id: "general", label: "General" },
    { id: "interface", label: "Interface" },
    { id: "tools", label: "Tools" },
    { id: "history", label: "History" },
    { id: "transparency", label: "Transparency & Gamut" },
    { id: "cursors", label: "Cursors" },
    { id: "units", label: "Units & Rulers" },
  ] as const;

  // svelte-ignore state_referenced_locally
  let cat = $state<string>(page);
  const original: Settings = $state.snapshot(settings.value) as Settings;
  // Working copy; live-applied for theme/transparency so the user sees the effect.
  let draft = $state<Settings>({ ...original });
  const hasKeysDialog = $derived(Boolean(getCommand("ai.providers") ?? getCommand("ai.keys") ?? getCommand("settings.apiKeys")));

  $effect(() => {
    document.documentElement.dataset.theme = draft.theme;
  });
  $effect(() => {
    // Live preview of the transparency grid. `settings.set` reads `settings.value`, so
    // untrack it or the effect would depend on what it writes.
    const patch = { checkerSize: draft.checkerSize, checkerColors: draft.checkerColors };
    untrack(() => void settings.set(patch));
  });

  const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
    { id: "darkest", label: "Darkest", swatch: "#232323" },
    { id: "dark", label: "Dark", swatch: "#323232" },
    { id: "medium", label: "Medium", swatch: "#535353" },
    { id: "light", label: "Light", swatch: "#b8b8b8" },
  ];

  async function ok() {
    await settings.set({
      ...draft,
      historyBudgetMb: Math.max(64, Math.min(16384, Math.round(draft.historyBudgetMb))),
      historyStates: Math.max(1, Math.min(1000, Math.round(draft.historyStates))),
    });
    resolve(null);
  }
  async function cancel() {
    document.documentElement.dataset.theme = original.theme;
    await settings.set({ theme: original.theme, checkerSize: original.checkerSize, checkerColors: original.checkerColors });
    resolve(null);
  }
  function resetPage() {
    const d = DEFAULT_SETTINGS;
    switch (cat) {
      case "interface":
        draft = { ...draft, theme: d.theme, toolbarDoubleColumn: d.toolbarDoubleColumn, showToolTips: d.showToolTips };
        break;
      case "history":
        draft = { ...draft, historyBudgetMb: d.historyBudgetMb, historyStates: d.historyStates };
        break;
      case "transparency":
        draft = { ...draft, checkerSize: d.checkerSize, checkerColors: d.checkerColors };
        break;
      case "cursors":
        draft = { ...draft, paintingCursor: d.paintingCursor, otherCursor: d.otherCursor };
        break;
      case "units":
        draft = { ...draft, rulerUnit: d.rulerUnit };
        break;
      case "tools":
        draft = { ...draft, zoomWithWheel: d.zoomWithWheel, showTransformValues: d.showTransformValues };
        break;
      default:
        draft = { ...draft, defaultProvider: d.defaultProvider };
    }
  }
</script>

<Dialog title="Preferences" width={640} oncancel={cancel} onsubmit={ok}>
  <div class="prefs">
    <nav class="cats" aria-label="Preference pages">
      {#each CATEGORIES as c (c.id)}
        <button type="button" class="cat" class:on={cat === c.id} onclick={() => (cat = c.id)}>{c.label}</button>
      {/each}
    </nav>
    <div class="page">
      {#if cat === "general"}
        <fieldset class="ps-group">
          <legend>Options</legend>
          <div class="row">
            <span class="lbl">Default AI provider:</span>
            <PsSelect value={draft.defaultProvider ?? ""} choices={[{ value: "", label: "Ask each time" }, { value: "open_ai", label: "OpenAI (ChatGPT)" }, { value: "x_ai", label: "xAI (Grok)" }, { value: "gemini", label: "Google Gemini" }]} width={180} onchange={(v) => (draft.defaultProvider = (v || null) as Settings["defaultProvider"])} />
          </div>
          <div class="row">
            <span class="lbl">AI providers:</span>
            {#if hasKeysDialog}
              <button type="button" class="btn" onclick={() => void (runCommand("ai.providers").then((r) => r || runCommand("ai.keys")).then((r) => r || runCommand("settings.apiKeys")))}>Manage…</button>
            {:else}
              <span class="hint">Available once the AI module is installed.</span>
            {/if}
          </div>
        </fieldset>
        <fieldset class="ps-group">
          <legend>Recent files</legend>
          <div class="row">
            <span class="lbl">Recent File List:</span>
            <button type="button" class="btn" onclick={() => void recentClear()}>Clear</button>
          </div>
        </fieldset>
      {:else if cat === "interface"}
        <fieldset class="ps-group">
          <legend>Appearance</legend>
          <div class="row">
            <span class="lbl">Color Theme:</span>
            <span class="themes" role="radiogroup">
              {#each THEMES as t (t.id)}
                <button type="button" role="radio" class="theme" class:on={draft.theme === t.id} aria-checked={draft.theme === t.id} aria-label={t.label} data-tip={t.label} style:background={t.swatch} onclick={() => (draft.theme = t.id)}></button>
              {/each}
            </span>
          </div>
          <div class="row">
            <span class="lbl"></span>
            <label class="chk"><input type="checkbox" bind:checked={draft.showToolTips} /> Show Tool Tips</label>
          </div>
        </fieldset>
        <fieldset class="ps-group">
          <legend>Toolbar</legend>
          <div class="row">
            <span class="lbl"></span>
            <label class="chk"><input type="checkbox" bind:checked={draft.toolbarDoubleColumn} /> Double-column toolbar</label>
          </div>
          <div class="row">
            <span class="lbl">Panels:</span>
            <button type="button" class="btn" onclick={() => ui.resetWorkspace()}>Reset Essentials</button>
          </div>
        </fieldset>
      {:else if cat === "tools"}
        <fieldset class="ps-group">
          <legend>Options</legend>
          <div class="row"><span class="lbl"></span><label class="chk"><input type="checkbox" bind:checked={draft.zoomWithWheel} /> Zoom with Scroll Wheel</label></div>
          <div class="row"><span class="lbl"></span><label class="chk"><input type="checkbox" bind:checked={draft.showTransformValues} /> Show Transformation Values</label></div>
        </fieldset>
      {:else if cat === "history"}
        <fieldset class="ps-group">
          <legend>History</legend>
          <div class="row">
            <span class="lbl">History States:</span>
            <ScrubbyNumber value={draft.historyStates} min={1} max={1000} step={1} slider={false} width={52} onchange={(v) => (draft.historyStates = v)} />
          </div>
          <div class="row">
            <span class="lbl">Memory for undo:</span>
            <ScrubbyNumber value={draft.historyBudgetMb} min={64} max={16384} step={64} unit="MB" slider={false} width={60} onchange={(v) => (draft.historyBudgetMb = v)} />
            <span class="hint">layer snapshots kept; oldest steps are forgotten first</span>
          </div>
        </fieldset>
      {:else if cat === "transparency"}
        <fieldset class="ps-group">
          <legend>Transparency Settings</legend>
          <div class="row">
            <span class="lbl">Grid Size:</span>
            <PsSelect value={draft.checkerSize} choices={[{ value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} width={120} onchange={(v) => (draft.checkerSize = v as Settings["checkerSize"])} />
          </div>
          <div class="row">
            <span class="lbl">Grid Colors:</span>
            <PsSelect value={draft.checkerColors} choices={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "dark", label: "Dark" }, { value: "red", label: "Red" }, { value: "orange", label: "Orange" }, { value: "green", label: "Green" }, { value: "blue", label: "Blue" }, { value: "purple", label: "Purple" }]} width={120} onchange={(v) => (draft.checkerColors = v as Settings["checkerColors"])} />
            <span class="checker" data-size={draft.checkerSize} data-colors={draft.checkerColors}></span>
          </div>
        </fieldset>
        <fieldset class="ps-group">
          <legend>Gamut Warning</legend>
          <div class="row"><span class="lbl"></span><span class="hint">Color management arrives with a later wave.</span></div>
        </fieldset>
      {:else if cat === "cursors"}
        <fieldset class="ps-group">
          <legend>Painting Cursors</legend>
          <div class="row"><span class="lbl"></span><label class="chk"><input type="radio" name="pc" value="standard" bind:group={draft.paintingCursor} /> Standard</label></div>
          <div class="row"><span class="lbl"></span><label class="chk"><input type="radio" name="pc" value="precise" bind:group={draft.paintingCursor} /> Precise</label></div>
          <div class="row"><span class="lbl"></span><label class="chk"><input type="radio" name="pc" value="brush-size" bind:group={draft.paintingCursor} /> Normal Brush Tip</label></div>
        </fieldset>
        <fieldset class="ps-group">
          <legend>Other Cursors</legend>
          <div class="row"><span class="lbl"></span><label class="chk"><input type="radio" name="oc" value="standard" bind:group={draft.otherCursor} /> Standard</label></div>
          <div class="row"><span class="lbl"></span><label class="chk"><input type="radio" name="oc" value="precise" bind:group={draft.otherCursor} /> Precise</label></div>
        </fieldset>
      {:else if cat === "units"}
        <fieldset class="ps-group">
          <legend>Units</legend>
          <div class="row">
            <span class="lbl">Rulers:</span>
            <PsSelect value={draft.rulerUnit} choices={[{ value: "px", label: "Pixels" }, { value: "in", label: "Inches" }, { value: "cm", label: "Centimeters" }, { value: "mm", label: "Millimeters" }, { value: "%", label: "Percent" }]} width={120} onchange={(v) => (draft.rulerUnit = v as Settings["rulerUnit"])} />
          </div>
          <div class="row"><span class="lbl"></span><span class="hint">Show rulers with View ▸ Rulers (Ctrl+R).</span></div>
        </fieldset>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <button type="button" class="btn reset" onclick={resetPage}>Reset Page</button>
    <span class="fgrow"></span>
    <button type="button" class="btn" onclick={cancel}>Cancel</button>
    <button type="button" class="btn primary" onclick={ok}>OK</button>
  {/snippet}
</Dialog>

<style>
  .prefs {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 12px;
    min-height: 300px;
  }
  .cats {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
  }
  .cat {
    height: var(--row-h);
    padding: 0 8px;
    text-align: left;
    color: var(--ps-text);
  }
  .cat:hover {
    background: var(--ps-hover);
  }
  .cat.on {
    background: var(--ps-row-selected);
  }
  .page {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  fieldset {
    margin: 6px 0 0;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--row-h);
  }
  .lbl {
    width: 120px;
    flex: none;
    text-align: right;
    color: var(--ps-text-dim);
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
  }
  .themes {
    display: inline-flex;
    gap: 6px;
  }
  .theme {
    width: 26px;
    height: 20px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  }
  .theme.on {
    outline: 2px solid var(--ps-accent);
    outline-offset: 1px;
  }
  .checker {
    width: 48px;
    height: 20px;
    border: 1px solid var(--ps-border-dark);
    --c1: #fff;
    --c2: #ccc;
    --s: 8px;
    background-image: linear-gradient(45deg, var(--c2) 25%, transparent 25%, transparent 75%, var(--c2) 75%), linear-gradient(45deg, var(--c2) 25%, transparent 25%, transparent 75%, var(--c2) 75%);
    background-color: var(--c1);
    background-size: var(--s) var(--s);
    background-position: 0 0, calc(var(--s) / 2) calc(var(--s) / 2);
  }
  .checker[data-size="small"] {
    --s: 4px;
  }
  .checker[data-size="large"] {
    --s: 16px;
  }
  .checker[data-size="none"] {
    background-image: none;
  }
  .checker[data-colors="medium"] {
    --c1: #ccc;
    --c2: #999;
  }
  .checker[data-colors="dark"] {
    --c1: #999;
    --c2: #666;
  }
  .checker[data-colors="red"] {
    --c1: #ffd9d9;
    --c2: #f99;
  }
  .checker[data-colors="orange"] {
    --c1: #ffe6bf;
    --c2: #fb7;
  }
  .checker[data-colors="green"] {
    --c1: #d9ffd9;
    --c2: #9e9;
  }
  .checker[data-colors="blue"] {
    --c1: #d9e6ff;
    --c2: #9bf;
  }
  .checker[data-colors="purple"] {
    --c1: #edd9ff;
    --c2: #c9f;
  }
  .fgrow {
    flex: 1;
  }
</style>
