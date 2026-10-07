<script lang="ts">
  /** Move tool align buttons (to the selection, else the canvas). */
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { canvasHost } from "$lib/ui/canvas/host.svelte";
  import { MoveTool, type Tool } from "$lib/tools";
  import type { AlignKind } from "../move";

  interface Props {
    tool: Tool;
  }
  let { tool }: Props = $props();
  const ITEMS: { kind: AlignKind; icon: string; title: string }[] = [
    { kind: "top", icon: "align-top", title: "Align top edges" },
    { kind: "vcenter", icon: "align-vcenter", title: "Align vertical centers" },
    { kind: "bottom", icon: "align-bottom", title: "Align bottom edges" },
    { kind: "left", icon: "align-left", title: "Align left edges" },
    { kind: "hcenter", icon: "align-hcenter", title: "Align horizontal centers" },
    { kind: "right", icon: "align-right", title: "Align right edges" },
  ];
  function run(kind: AlignKind) {
    const ctx = canvasHost.context(tool);
    if (ctx && tool instanceof MoveTool) tool.align(ctx, kind);
  }
</script>

<span class="al" role="group" aria-label="Align">
  {#each ITEMS as it (it.kind)}
    <button type="button" class="b" data-tip={it.title} aria-label={it.title} disabled={!(tool instanceof MoveTool)} onclick={() => run(it.kind)}>
      <Icon name={it.icon} size={16} />
    </button>
  {/each}
</span>

<style>
  .al {
    display: inline-flex;
    gap: 1px;
  }
  .b {
    display: grid;
    place-items: center;
    width: 22px;
    height: 20px;
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .b:hover:not(:disabled) {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .b:disabled {
    opacity: 0.4;
  }
</style>
