<script lang="ts">
  /**
   * Left toolbar placeholder. Real tools (PLAN.md section 2.1) are wired by the
   * ui-shell-tools wave; this only shows the tool list with Photoshop shortcuts.
   */
  import {
    MousePointer2,
    SquareDashed,
    Lasso,
    Wand2,
    Crop,
    Pipette,
    Brush,
    Eraser,
    PaintBucket,
    Stamp,
    Type,
    ZoomIn,
    Hand,
  } from "@lucide/svelte";
  import type { Component } from "svelte";

  interface ToolDef {
    id: string;
    label: string;
    key: string;
    icon: Component<{ size?: number | string; strokeWidth?: number | string }>;
  }

  interface Props {
    active?: string;
  }

  let { active = $bindable("move") }: Props = $props();

  const tools: ToolDef[] = [
    { id: "move", label: "Move", key: "V", icon: MousePointer2 },
    { id: "marquee", label: "Marquee", key: "M", icon: SquareDashed },
    { id: "lasso", label: "Lasso", key: "L", icon: Lasso },
    { id: "wand", label: "Magic Wand", key: "W", icon: Wand2 },
    { id: "crop", label: "Crop", key: "C", icon: Crop },
    { id: "eyedropper", label: "Eyedropper", key: "I", icon: Pipette },
    { id: "brush", label: "Brush", key: "B", icon: Brush },
    { id: "eraser", label: "Eraser", key: "E", icon: Eraser },
    { id: "bucket", label: "Paint Bucket / Gradient", key: "G", icon: PaintBucket },
    { id: "clone", label: "Clone Stamp", key: "S", icon: Stamp },
    { id: "text", label: "Text", key: "T", icon: Type },
    { id: "zoom", label: "Zoom", key: "Z", icon: ZoomIn },
    { id: "hand", label: "Hand", key: "H", icon: Hand },
  ];
</script>

<aside class="toolbar" aria-label="Tools">
  {#each tools as t (t.id)}
    <button
      type="button"
      class="tool"
      class:active={active === t.id}
      title="{t.label} ({t.key})"
      aria-label={t.label}
      aria-pressed={active === t.id}
      onclick={() => (active = t.id)}
    >
      <t.icon size={18} strokeWidth={1.75} />
    </button>
  {/each}

  <div class="grow"></div>

  <div class="swatches" title="Foreground / background colour">
    <span class="fg"></span>
    <span class="bg"></span>
  </div>
</aside>

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 0;
    background: var(--bg-1);
    border-right: 1px solid var(--border);
    overflow: hidden;
  }

  .tool {
    width: 36px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    color: var(--fg-1);
    transition: background 90ms ease, color 90ms ease, box-shadow 120ms ease;
  }
  .tool:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .tool.active {
    background: var(--accent-soft);
    color: var(--accent-2);
    box-shadow: inset 0 0 0 1px rgba(124, 92, 255, 0.45);
  }

  .grow {
    flex: 1;
  }

  .swatches {
    position: relative;
    width: 30px;
    height: 30px;
    margin-bottom: 4px;
  }
  .swatches span {
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 3px;
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-1);
  }
  .swatches .bg {
    right: 0;
    bottom: 0;
    background: #ffffff;
  }
  .swatches .fg {
    left: 0;
    top: 0;
    background: #000000;
    z-index: 1;
  }
</style>
