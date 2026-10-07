<script lang="ts">
  /**
   * Options bar (28 px): tool preset picker at left, then the tool's option schema in PS
   * idioms — scrubby numbers with ▾ sliders, selection-mode segmented icons, PS checkboxes,
   * dropdowns — and a workspace switcher at the right.
   */
  import { toolStore, rgbaToHex, hexToRgba } from "$lib/stores/tool.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { toolGlyph, toolLabel, type ToolOption } from "$lib/tools";
  import { canvasHost } from "./canvas/host.svelte";
  import Icon from "./icons/Icon.svelte";
  import ScrubbyNumber from "./controls/ScrubbyNumber.svelte";
  import PsSelect from "./controls/PsSelect.svelte";
  import Segmented from "./controls/Segmented.svelte";
  import Popover from "./controls/Popover.svelte";
  import CustomOption from "$lib/tools/ui/CustomOption.svelte";

  const tool = $derived(canvasHost.selectedTool);
  let presetBtn = $state<HTMLButtonElement | null>(null);
  let presetOpen = $state(false);
  let wsBtn = $state<HTMLButtonElement | null>(null);
  let wsOpen = $state(false);

  const SEL_MODES = [
    { value: "new", icon: "sel-new", title: "New selection" },
    { value: "add", icon: "sel-add", title: "Add to selection" },
    { value: "subtract", icon: "sel-subtract", title: "Subtract from selection" },
    { value: "intersect", icon: "sel-intersect", title: "Intersect with selection" },
  ] as const;

  function num(o: Extract<ToolOption, { kind: "number" }>): number {
    return toolStore.option(tool.id, o.key, o.default);
  }
  function setNum(o: Extract<ToolOption, { kind: "number" }>, v: number) {
    if (!Number.isFinite(v)) return;
    toolStore.setOption(tool.id, o.key, Math.max(o.min, Math.min(o.max, v)));
    canvasHost.invalidateOverlay();
  }
  function str(o: Extract<ToolOption, { kind: "select" | "text" }>): string {
    return toolStore.option(tool.id, o.key, o.default);
  }
  function bool(o: Extract<ToolOption, { kind: "toggle" }>): boolean {
    return toolStore.option(tool.id, o.key, o.default);
  }
  function set(key: string, v: string | boolean) {
    toolStore.setOption(tool.id, key, v);
    canvasHost.invalidateOverlay();
  }
  function runButton(o: Extract<ToolOption, { kind: "button" }>) {
    const ctx = canvasHost.context(tool);
    if (ctx) o.action(ctx);
  }
  function isSelectionMode(o: Extract<ToolOption, { kind: "select" }>): boolean {
    const v = o.choices.map((c) => c.value);
    return o.key === "mode" && v.includes("new") && v.includes("add") && v.includes("subtract");
  }
  const hasResettable = $derived(tool.options.some((o) => o.kind !== "button" && o.kind !== "color" && o.kind !== "separator"));
</script>

<div class="options" role="toolbar" aria-label="Tool options">
  <button type="button" class="preset" bind:this={presetBtn} data-tip="Tool Preset picker" aria-label="Tool presets" onclick={() => (presetOpen = !presetOpen)}>
    <Icon name={toolGlyph(tool.id, tool)} size={16} />
    <Icon name="caret-small" size={12} />
  </button>
  <Popover anchor={presetBtn} open={presetOpen} onclose={() => (presetOpen = false)} minWidth={200}>
    <div class="presets">
      <div class="ph">{toolLabel(tool)} presets</div>
      {#if tool.presets?.length}
        {#each tool.presets as p (p.id)}
          <button type="button" class="prow" onclick={() => { for (const [k, v] of Object.entries(p.options)) toolStore.setOption(tool.id, k, v); presetOpen = false; }}>{p.name}</button>
        {/each}
      {:else}
        <div class="pempty">No presets for this tool yet.</div>
      {/if}
      <div class="psep"></div>
      <button type="button" class="prow" disabled={!hasResettable} onclick={() => { toolStore.resetOptions(tool.id); canvasHost.invalidateOverlay(); presetOpen = false; }}>Reset Tool</button>
    </div>
  </Popover>
  <span class="sep"></span>

  {#each tool.options as o (o.key)}
    {#if o.kind === "number"}
      <ScrubbyNumber label={o.label} value={num(o)} min={o.min} max={o.max} step={o.step ?? 1} log={o.log ?? false} unit={o.unit ?? ""} slider={o.slider !== false} onchange={(v) => setNum(o, v)} />
    {:else if o.kind === "select"}
      {#if isSelectionMode(o)}
        <Segmented value={str(o)} items={SEL_MODES} onchange={(v) => set(o.key, v)} />
      {:else}
        <PsSelect label={o.label} value={str(o)} choices={o.choices} onchange={(v) => set(o.key, v)} />
      {/if}
    {:else if o.kind === "toggle"}
      <label class="chk">
        <input type="checkbox" checked={bool(o)} onchange={(e) => set(o.key, e.currentTarget.checked)} />
        <span>{o.label}</span>
      </label>
    {:else if o.kind === "text"}
      <label class="opt">
        <span class="lbl">{o.label}:</span>
        <input class="input" type="text" value={str(o)} placeholder={o.placeholder} style:width="{o.width ?? 120}px" onchange={(e) => set(o.key, e.currentTarget.value)} />
      </label>
    {:else if o.kind === "color"}
      {@const c = o.key === "fg" ? toolStore.fg : toolStore.bg}
      <label class="opt" title={o.label || "Set the text color"}>
        {#if o.label}<span class="lbl">{o.label}:</span>{/if}
        <span class="swatch" style:background={rgbaToHex(c)}>
          <input type="color" value={rgbaToHex(c)} oninput={(e) => { const v = hexToRgba(e.currentTarget.value); if (v) (o.key === "fg" ? toolStore.setFg(v) : toolStore.setBg(v)); }} aria-label={o.label || "Color"} />
        </span>
      </label>
    {:else if o.kind === "custom"}
      <CustomOption option={o} {tool} />
    {:else if o.kind === "button"}
      <button type="button" class="btn sm" class:primary={o.primary} onclick={() => runButton(o)}>{o.label}</button>
    {:else}
      <span class="sep"></span>
    {/if}
  {/each}

  <span class="grow"></span>
  <span class="sep"></span>
  <button type="button" class="ws" bind:this={wsBtn} aria-label="Workspace" onclick={() => (wsOpen = !wsOpen)}>
    <Icon name="workspace" size={14} />
    <span>{ui.workspace.name}</span>
    <Icon name="caret-small" size={12} />
  </button>
  <Popover anchor={wsBtn} open={wsOpen} onclose={() => (wsOpen = false)} align="right" minWidth={180}>
    <div class="presets">
      <button type="button" class="prow on" onclick={() => (wsOpen = false)}><span class="pchk"><Icon name="check" size={12} /></span>Essentials</button>
      <div class="psep"></div>
      <button type="button" class="prow" onclick={() => { ui.resetWorkspace(); wsOpen = false; }}><span class="pchk"></span>Reset Essentials</button>
    </div>
  </Popover>
</div>

<style>
  .options {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--optionsbar-h);
    padding: 0 6px 0 4px;
    background: var(--ps-app);
    border-bottom: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 -1px 0 var(--ps-border-light);
    font-size: var(--fs-sm);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
  }
  .options::-webkit-scrollbar {
    height: 0;
  }
  .preset {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    height: 22px;
    padding: 0 2px 0 4px;
    border-radius: 2px;
    color: var(--ps-text);
  }
  .preset:hover {
    background: var(--ps-hover);
  }
  .sep {
    flex: none;
    width: 1px;
    height: 18px;
    background: var(--ps-border-dark);
    box-shadow: 1px 0 0 var(--ps-border-light);
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .lbl {
    color: var(--ps-text-dim);
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ps-text);
  }
  .swatch {
    position: relative;
    width: 18px;
    height: 18px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
    overflow: hidden;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
  }
  .grow {
    flex: 1;
  }
  .ws {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 3px 0 5px;
    border-radius: 2px;
    color: var(--ps-text);
  }
  .ws:hover {
    background: var(--ps-hover);
  }
  .presets {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .ph {
    padding: 2px 8px 4px;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .prow {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 10px 0 6px;
    text-align: left;
    color: var(--ps-text);
  }
  .prow:hover:not(:disabled) {
    background: var(--ps-row-selected);
  }
  .prow:disabled {
    color: var(--ps-text-disabled);
  }
  .pchk {
    display: grid;
    width: 16px;
    place-items: center;
  }
  .pempty {
    padding: 2px 8px 4px;
    color: var(--ps-text-disabled);
  }
  .psep {
    height: 1px;
    margin: 3px 0;
    background: var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
  }
</style>
