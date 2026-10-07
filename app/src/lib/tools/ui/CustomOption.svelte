<script lang="ts">
  /**
   * Options-bar renderer for `kind: "custom"` tool options (tools-v2). Dispatches on
   * `option.renderer`; the stored value lives in the tool store like every other option.
   */
  import type { Tool, ToolOption } from "$lib/tools";
  import { toolStore, type OptionValue } from "$lib/stores/tool.svelte";
  import { canvasHost } from "$lib/ui/canvas/host.svelte";
  import Segmented from "$lib/ui/controls/Segmented.svelte";
  import BrushPicker from "./BrushPicker.svelte";
  import GradientPicker from "./GradientPicker.svelte";
  import ShapePicker from "./ShapePicker.svelte";
  import FontPicker from "./FontPicker.svelte";
  import FillPicker from "./FillPicker.svelte";
  import PatternPicker from "./PatternPicker.svelte";
  import MeasureReadout from "./MeasureReadout.svelte";
  import AlignButtons from "./AlignButtons.svelte";

  interface Props {
    option: Extract<ToolOption, { kind: "custom" }>;
    tool: Tool;
  }
  let { option, tool }: Props = $props();

  const value = $derived(toolStore.option(tool.id, option.key, (option.default ?? "") as OptionValue));
  function set(v: OptionValue) {
    toolStore.setOption(tool.id, option.key, v);
    canvasHost.invalidateOverlay();
  }
  type Seg = { value: string; icon: string; title: string };
  const items = $derived(((option.props?.items as Seg[] | undefined) ?? []) as readonly Seg[]);
</script>

{#if option.renderer === "brush-picker"}
  <BrushPicker />
{:else if option.renderer === "gradient-picker"}
  <GradientPicker value={String(value)} onchange={(v) => set(v)} />
{:else if option.renderer === "shape-picker"}
  <ShapePicker value={String(value)} onchange={(v) => set(v)} />
{:else if option.renderer === "font-picker"}
  <FontPicker value={String(value)} onchange={(v) => set(v)} />
{:else if option.renderer === "fill-picker"}
  <FillPicker label={option.label ?? ""} value={String(value)} allowNone={option.props?.allowNone === true} onchange={(v) => set(v)} />
{:else if option.renderer === "pattern-picker"}
  <PatternPicker value={String(value)} onchange={(v) => set(v)} />
{:else if option.renderer === "measure-readout"}
  <MeasureReadout />
{:else if option.renderer === "align-buttons"}
  <AlignButtons {tool} />
{:else if option.renderer === "icon-select"}
  {#if option.label}<span class="lbl">{option.label}:</span>{/if}
  <Segmented value={String(value)} {items} onchange={(v) => set(v)} />
{/if}

<style>
  .lbl {
    color: var(--ps-text-dim);
  }
</style>
