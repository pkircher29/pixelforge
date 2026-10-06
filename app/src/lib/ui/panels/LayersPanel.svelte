<script lang="ts">
  import { Eye, EyeOff, Lock, LockOpen, Plus, Copy, Trash2, FolderPlus, ChevronDown, ChevronRight } from "@lucide/svelte";
  import {
    BLEND_MODES,
    BLEND_MODE_LABEL,
    ReorderLayerCommand,
    SetLayerPropsCommand,
    layerBlock,
    type BlendMode,
    type Layer,
    type LayerProps,
  } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { runCommand, getCommand } from "../registry.svelte";
  import { contextMenu, type ContextMenuItem } from "../context-menu.svelte";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";
  import LayerThumb from "./LayerThumb.svelte";
  import { reorderTarget } from "./layer-reorder";

  const entry = $derived(docStore.active);
  const doc = $derived(entry?.doc ?? null);

  /** Snapshot of a layer row. Engine objects are raw (not reactive), so every value the
   * template shows is copied here when `version` ticks. */
  interface Row {
    layer: Layer;
    index: number;
    depth: number;
    isActive: boolean;
    isGroup: boolean;
    name: string;
    visible: boolean;
    locked: boolean;
    collapsed: boolean;
    blendLabel: string | null;
    opacityPct: number;
    docW: number;
    docH: number;
  }

  const rows = $derived.by((): Row[] => {
    if (!entry) return [];
    void entry.version;
    const d = entry.doc;
    const layers = d.layers;
    const collapsed = new Set(layers.filter((l) => l.kind === "group" && l.collapsed).map((l) => l.id));
    const out: Row[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      if (l.parentId && collapsed.has(l.parentId)) continue;
      out.push({
        layer: l,
        index: i,
        depth: l.parentId ? 1 : 0,
        isActive: l.id === d.activeLayerId,
        isGroup: l.kind === "group",
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        collapsed: l.kind === "group" && l.collapsed,
        blendLabel: l.blendMode === "normal" ? null : BLEND_MODE_LABEL[l.blendMode],
        opacityPct: Math.round(l.opacity * 100),
        docW: d.width,
        docH: d.height,
      });
    }
    return out;
  });

  /** Active layer controls (blend / opacity), snapshotted per version. */
  const active = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    const l = docStore.activeLayer;
    return l ? { layer: l, blendMode: l.blendMode, opacity: l.opacity } : null;
  });
  const layerCount = $derived.by(() => {
    if (!entry) return 0;
    void entry.version;
    return entry.doc.layers.length;
  });

  let renaming = $state<string | null>(null);
  let renameText = $state("");
  let dragId = $state<string | null>(null);
  let dropTarget = $state<{ id: string; above: boolean } | null>(null);

  function setProps(layer: Layer, props: Partial<LayerProps>) {
    docStore.exec(new SetLayerPropsCommand(layer.id, props));
  }

  function startRename(l: Layer) {
    renaming = l.id;
    renameText = l.name;
  }
  function commitRename(l: Layer) {
    if (renaming !== l.id) return;
    renaming = null;
    const name = renameText.trim();
    if (name && name !== l.name) setProps(l, { name });
  }

  function menuFor(l: Layer): ContextMenuItem[] {
    const sc = (id: string) => formatShortcut(getCommand(id)?.shortcut, IS_MAC);
    const item = (id: string, label: string, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({
      label,
      shortcut: sc(id),
      disabled: getCommand(id)?.enabled ? !getCommand(id)!.enabled!() : !getCommand(id),
      run: () => void runCommand(id),
      ...extra,
    });
    return [
      item("layer.duplicate", "Duplicate layer"),
      item("layer.properties", "Layer properties…"),
      { separator: true },
      item("layer.mergeDown", "Merge down"),
      item("layer.mergeVisible", "Merge visible"),
      item("layer.flatten", "Flatten image"),
      { separator: true },
      l.kind === "group" ? item("layer.ungroup", "Ungroup") : item("layer.group", "Group"),
      item("select.fromLayer", "Select pixels"),
      { separator: true },
      item("layer.delete", "Delete layer", { danger: true }),
    ];
  }

  function onContext(e: MouseEvent, l: Layer) {
    e.preventDefault();
    docStore.setActiveLayer(l.id);
    contextMenu.open(e.clientX, e.clientY, menuFor(l));
  }

  // Drag reorder (same nesting level only, v1).
  function onDragStart(e: DragEvent, l: Layer) {
    dragId = l.id;
    e.dataTransfer?.setData("text/plain", l.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e: DragEvent, l: Layer) {
    if (!dragId || !doc) return;
    const dragged = doc.layers.find((x) => x.id === dragId);
    if (!dragged || dragged.id === l.id || dragged.parentId !== l.parentId) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropTarget = { id: l.id, above: e.clientY < r.top + r.height / 2 };
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (!doc || !dragId || !dropTarget) return;
    const from = doc.layers.findIndex((x) => x.id === dragId);
    const target = doc.layers.findIndex((x) => x.id === dropTarget!.id);
    if (from >= 0 && target >= 0) {
      const block = layerBlock(doc, dragId);
      const to = reorderTarget(from, target, dropTarget.above, block.end - block.start);
      if (to !== from) docStore.exec(new ReorderLayerCommand(dragId, to));
    }
    dragId = null;
    dropTarget = null;
  }
  function onDragEnd() {
    dragId = null;
    dropTarget = null;
  }
</script>

<div class="layers">
  {#if entry && doc}
    <div class="controls">
      <select class="select" aria-label="Blend mode" disabled={!active} value={active?.blendMode ?? "normal"} onchange={(e) => active && setProps(active.layer, { blendMode: e.currentTarget.value as BlendMode })}>
        {#each BLEND_MODES as m (m)}<option value={m}>{BLEND_MODE_LABEL[m]}</option>{/each}
      </select>
      <label class="opacity">
        <span>Opacity</span>
        <input type="range" min="0" max="100" disabled={!active} value={Math.round((active?.opacity ?? 1) * 100)} oninput={(e) => active && setProps(active.layer, { opacity: Number(e.currentTarget.value) / 100 })} aria-label="Opacity" />
        <span class="val">{Math.round((active?.opacity ?? 1) * 100)}%</span>
      </label>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="list" role="listbox" aria-label="Layers" tabindex="-1" ondrop={onDrop} ondragover={(e) => e.preventDefault()}>
      {#each rows as r (r.layer.id)}
        {@const l = r.layer}
        <div
          class="row"
          class:active={r.isActive}
          class:child={r.depth > 0}
          class:hidden={!r.visible}
          class:drop-above={dropTarget?.id === l.id && dropTarget.above}
          class:drop-below={dropTarget?.id === l.id && !dropTarget.above}
          class:dragging={dragId === l.id}
          role="option"
          aria-selected={r.isActive}
          tabindex="0"
          draggable="true"
          onclick={() => docStore.setActiveLayer(l.id)}
          onkeydown={(e) => {
            if (e.key === "Enter") docStore.setActiveLayer(l.id);
            else if (e.key === "F2") startRename(l);
          }}
          oncontextmenu={(e) => onContext(e, l)}
          ondblclick={() => startRename(l)}
          ondragstart={(e) => onDragStart(e, l)}
          ondragover={(e) => onDragOver(e, l)}
          ondragend={onDragEnd}
        >
          <button type="button" class="eye" class:off={!r.visible} aria-label={r.visible ? "Hide layer" : "Show layer"} onclick={(e) => { e.stopPropagation(); setProps(l, { visible: !r.visible }); }}>
            {#if r.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
          </button>
          {#if r.isGroup}
            <button type="button" class="chev" aria-label={r.collapsed ? "Expand group" : "Collapse group"} onclick={(e) => { e.stopPropagation(); setProps(l, { collapsed: !r.collapsed }); }}>
              {#if r.collapsed}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}
            </button>
          {/if}
          <LayerThumb layer={l} docW={r.docW} docH={r.docH} version={entry.pixelVersion} />
          {#if renaming === l.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="rename"
              type="text"
              bind:value={renameText}
              autofocus
              onblur={() => commitRename(l)}
              onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename(l);
                if (e.key === "Escape") renaming = null;
              }}
              onclick={(e) => e.stopPropagation()}
            />
          {:else}
            <span class="name" title={r.name}>{r.name}</span>
          {/if}
          <span class="meta">
            {#if r.blendLabel}<span class="mode">{r.blendLabel}</span>{/if}
            {#if r.opacityPct < 100}<span class="op">{r.opacityPct}%</span>{/if}
          </span>
          <button type="button" class="lock" class:on={r.locked} aria-label={r.locked ? "Unlock layer" : "Lock layer"} onclick={(e) => { e.stopPropagation(); setProps(l, { locked: !r.locked }); }}>
            {#if r.locked}<Lock size={12} />{:else}<LockOpen size={12} />{/if}
          </button>
        </div>
      {/each}
    </div>

    <div class="footer">
      <button type="button" class="icon-btn" data-tip="New layer  {formatShortcut('CmdOrCtrl+Shift+N', IS_MAC)}" aria-label="New layer" onclick={() => void runCommand("layer.new")}><Plus size={15} /></button>
      <button type="button" class="icon-btn" data-tip="New group" aria-label="New group" onclick={() => void runCommand("layer.group")}><FolderPlus size={15} /></button>
      <button type="button" class="icon-btn" data-tip="Duplicate layer  {formatShortcut('CmdOrCtrl+J', IS_MAC)}" aria-label="Duplicate layer" onclick={() => void runCommand("layer.duplicate")}><Copy size={14} /></button>
      <span class="grow"></span>
      <button type="button" class="icon-btn danger" data-tip="Delete layer" aria-label="Delete layer" disabled={layerCount <= 1} onclick={() => void runCommand("layer.delete")}><Trash2 size={14} /></button>
    </div>
  {:else}
    <div class="empty">Open a document to see its layers.</div>
  {/if}
</div>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
  }
  .controls .select {
    flex: 1;
    min-width: 0;
  }
  .opacity {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--fg-2);
  }
  .opacity input {
    width: 60px;
  }
  .val {
    width: 32px;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--fg-1);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 8px 0 4px;
    font-size: var(--fs-sm);
    color: var(--fg-1);
    border-left: 2px solid transparent;
    transition: background var(--t-fast) ease-out;
  }
  .row:hover {
    background: var(--bg-2);
  }
  .row.active {
    background: var(--accent-soft);
    color: var(--fg-0);
    border-left-color: var(--accent);
  }
  .row.child {
    padding-left: 22px;
  }
  .row.hidden .name {
    color: var(--fg-2);
  }
  .row.dragging {
    opacity: 0.4;
  }
  .row.drop-above::before,
  .row.drop-below::after {
    content: "";
    position: absolute;
    left: 6px;
    right: 6px;
    height: 2px;
    background: var(--accent-2);
    box-shadow: 0 0 6px var(--accent-2);
  }
  .row.drop-above::before {
    top: -1px;
  }
  .row.drop-below::after {
    bottom: -1px;
  }
  .eye,
  .lock,
  .chev {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: var(--fg-2);
    flex: none;
  }
  .eye:hover,
  .lock:hover,
  .chev:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .eye:not(.off) {
    color: var(--fg-1);
  }
  .lock {
    opacity: 0;
  }
  .row:hover .lock,
  .lock.on {
    opacity: 1;
  }
  .lock.on {
    color: var(--accent-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename {
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
    font: inherit;
    background: var(--bg-0);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--fg-0);
    outline: none;
  }
  .meta {
    display: flex;
    gap: 6px;
    color: var(--fg-2);
    font-size: 10px;
    font-family: var(--font-mono);
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    border-top: 1px solid var(--border);
  }
  .grow {
    flex: 1;
  }
  .danger:not(:disabled):hover {
    color: var(--danger);
  }
  .empty {
    padding: 14px 10px;
    color: var(--fg-2);
    font-size: var(--fs-sm);
  }
</style>
