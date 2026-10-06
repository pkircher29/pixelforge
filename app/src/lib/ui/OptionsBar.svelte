<script lang="ts">
  /** Options bar auto-rendered from the selected tool's option schema. */
  import { RotateCcw } from "@lucide/svelte";
  import { toolStore, rgbaToHex, hexToRgba } from "$lib/stores/tool.svelte";
  import type { ToolOption } from "$lib/tools";
  import { canvasHost } from "./canvas/host.svelte";

  const tool = $derived(canvasHost.selectedTool);

  function num(o: Extract<ToolOption, { kind: "number" }>): number {
    return toolStore.option(tool.id, o.key, o.default);
  }
  function setNum(o: Extract<ToolOption, { kind: "number" }>, v: number) {
    if (!Number.isFinite(v)) return;
    toolStore.setOption(tool.id, o.key, Math.max(o.min, Math.min(o.max, v)));
    canvasHost.invalidateOverlay();
  }
  // Log sliders map 0..1000 ↔ min..max exponentially.
  function toSlider(o: Extract<ToolOption, { kind: "number" }>, v: number): number {
    if (!o.log) return v;
    const lo = Math.log(Math.max(1, o.min));
    const hi = Math.log(o.max);
    return Math.round(((Math.log(Math.max(1, v)) - lo) / (hi - lo)) * 1000);
  }
  function fromSlider(o: Extract<ToolOption, { kind: "number" }>, s: number): number {
    if (!o.log) return s;
    const lo = Math.log(Math.max(1, o.min));
    const hi = Math.log(o.max);
    return Math.round(Math.exp(lo + (s / 1000) * (hi - lo)));
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
</script>

<div class="options" role="toolbar" aria-label="Tool options">
  <span class="tool-name"><tool.icon size={14} strokeWidth={1.75} />{tool.name}</span>
  <span class="sep"></span>
  {#each tool.options as o (o.key)}
    {#if o.kind === "number"}
      <label class="opt">
        <span class="lbl">{o.label}</span>
        {#if o.slider !== false}
          <input type="range" min={o.log ? 0 : o.min} max={o.log ? 1000 : o.max} step={o.log ? 1 : (o.step ?? 1)} value={toSlider(o, num(o))} oninput={(e) => setNum(o, fromSlider(o, Number(e.currentTarget.value)))} aria-label={o.label} />
        {/if}
        <input class="input num" type="number" min={o.min} max={o.max} step={o.step ?? 1} value={num(o)} onchange={(e) => setNum(o, Number(e.currentTarget.value))} aria-label={o.label} />
        {#if o.unit}<span class="unit">{o.unit}</span>{/if}
      </label>
    {:else if o.kind === "select"}
      <label class="opt">
        <span class="lbl">{o.label}</span>
        <select class="select" value={str(o)} onchange={(e) => set(o.key, e.currentTarget.value)}>
          {#each o.choices as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
        </select>
      </label>
    {:else if o.kind === "toggle"}
      <label class="opt chk" class:on={bool(o)}>
        <input type="checkbox" checked={bool(o)} onchange={(e) => set(o.key, e.currentTarget.checked)} />
        <span class="lbl">{o.label}</span>
      </label>
    {:else if o.kind === "text"}
      <label class="opt">
        <span class="lbl">{o.label}</span>
        <input class="input" type="text" value={str(o)} placeholder={o.placeholder} style:width="{o.width ?? 140}px" onchange={(e) => set(o.key, e.currentTarget.value)} />
      </label>
    {:else if o.kind === "color"}
      {@const c = o.key === "fg" ? toolStore.fg : toolStore.bg}
      <label class="opt">
        <span class="lbl">{o.label}</span>
        <span class="swatch" style:background={rgbaToHex(c)}>
          <input type="color" value={rgbaToHex(c)} oninput={(e) => { const v = hexToRgba(e.currentTarget.value); if (v) (o.key === "fg" ? toolStore.setFg(v) : toolStore.setBg(v)); }} aria-label={o.label} />
        </span>
      </label>
    {:else if o.kind === "button"}
      <button type="button" class="btn sm" class:primary={o.primary} onclick={() => runButton(o)}>{o.label}</button>
    {:else}
      <span class="sep"></span>
    {/if}
  {/each}
  <span class="grow"></span>
  {#if tool.options.some((o) => o.kind !== "button" && o.kind !== "color" && o.kind !== "separator")}
    <button type="button" class="icon-btn" data-tip="Reset tool options" aria-label="Reset tool options" onclick={() => { toolStore.resetOptions(tool.id); canvasHost.invalidateOverlay(); }}>
      <RotateCcw size={13} />
    </button>
  {/if}
</div>

<style>
  .options {
    display: flex;
    align-items: center;
    gap: 14px;
    height: var(--optionsbar-h);
    padding: 0 10px 0 12px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
  }
  .tool-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .sep {
    flex: none;
    width: 1px;
    height: 16px;
    background: var(--border-strong);
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .lbl {
    color: var(--fg-1);
  }
  .num {
    width: 58px;
    text-align: right;
  }
  .unit {
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  input[type="range"] {
    width: 90px;
  }
  .chk input {
    accent-color: var(--accent);
  }
  .chk.on .lbl {
    color: var(--fg-0);
  }
  .swatch {
    position: relative;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.25);
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
</style>
