<script lang="ts">
  /**
   * Layers panel — Photoshop CC layout: filter row, blend mode + opacity, lock row +
   * fill, 40 px rows (eye · thumb · chain · mask · name · fx ▾ · lock), effect
   * sub-rows, groups with disclosure, clipped layers with ↳, multi-select, pointer
   * drag-reorder with insertion line / drop-into-group, Alt-drag duplicate, the PS
   * modifier clicks (Ctrl thumb → selection, Shift mask → disable, Alt mask → view,
   * Alt eye → solo), inline rename, context menu and the seven-button bottom bar.
   */
  import { untrack } from "svelte";
  import {
    BLEND_MODES,
    BLEND_MODE_LABEL,
    DuplicateLayerCommand,
    SetLayerEffectsCommand,
    SetLayerLockCommand,
    SetLayerPropsCommand,
    SetMaskEnabledCommand,
    SetMaskLinkedCommand,
    SetSelectionCommand,
    cloneEffects,
    combineSelections,
    loadMaskAsSelection,
    selectionFromLayer,
    type BlendMode,
    type Layer,
    type LayerColor,
    type LayerId,
    type LayerProps,
    type SelectionCombineMode,
  } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { toast } from "$lib/stores/toast.svelte";
  import { runCommand, getCommand } from "../registry.svelte";
  import { contextMenu, type ContextMenuItem } from "../context-menu.svelte";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";
  import Icon from "../icons/Icon.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import Popover from "../controls/Popover.svelte";
  import LayerThumb from "./LayerThumb.svelte";
  import { layersUi, KIND_FILTERS, type FilterMode } from "./Layers.store.svelte";
  import { buildRows, selectOnClick, contextMenuState, SetLayersVisibleCommand, MoveLayerToCommand, EFFECT_ORDER, EFFECT_LABEL, type PanelRow, type LayerRowModel } from "./Layers.model";
  import { computeDrop, resolveDrop, type RowGeom, type DropTarget } from "./layer-reorder";
  import { thumbDims, rowHeight } from "./thumbnail";
  import { ADJUSTMENT_MENU, FILL_MENU } from "../commands/layer";

  const entry = $derived(docStore.active);
  const doc = $derived(entry?.doc ?? null);

  // Selection is per document.
  $effect(() => {
    const id = entry?.id ?? null;
    untrack(() => layersUi.bind(id));
  });

  const rows = $derived.by((): PanelRow[] => {
    if (!entry) return [];
    void entry.version;
    return buildRows(entry.doc, {
      filter: { on: layersUi.filterOn, mode: layersUi.filterMode, kinds: layersUi.kinds, name: layersUi.nameFilter, color: layersUi.colorFilter },
      expandedEffects: layersUi.expandedEffects,
      selected: layersUi.selectedLayerIds,
    });
  });
  const layerRows = $derived(rows.filter((r): r is LayerRowModel => r.kind === "layer"));
  /** Ids of clipping bases (their names are underlined like PS). */
  const baseIds = $derived.by(() => {
    const s = new Set<LayerId>();
    if (!doc) return s;
    void entry?.version;
    for (let i = 0; i < doc.layers.length; i++) {
      const l = doc.layers[i]!;
      if (!l.clipToBelow) continue;
      for (let j = i - 1; j >= 0; j--) {
        const b = doc.layers[j]!;
        if (b.parentId !== l.parentId) continue;
        if (!b.clipToBelow) {
          s.add(b.id);
          break;
        }
      }
    }
    return s;
  });

  const dims = $derived(thumbDims(layersUi.thumbSize, doc?.width ?? 1, doc?.height ?? 1));
  const rowH = $derived(rowHeight(layersUi.thumbSize));

  /** Active layer controls, snapshotted per version. */
  const active = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    const l = docStore.activeLayer;
    return l ? { layer: l, blendMode: l.blendMode, opacity: l.opacity, fill: l.fillOpacity, lock: { ...l.lock }, isGroup: l.kind === "group" } : null;
  });
  const layerCount = $derived.by(() => {
    if (!entry) return 0;
    void entry.version;
    return entry.doc.layers.length;
  });
  const hasSelection = $derived.by(() => {
    if (!entry) return false;
    void entry.version;
    return !entry.doc.selection.isEmpty;
  });

  const BLEND_CHOICES = BLEND_MODES.map((m) => ({ value: m, label: BLEND_MODE_LABEL[m] }));
  const PASS_THROUGH = { value: "pass-through", label: "Pass Through" };
  const FILTER_MODES: { value: FilterMode; label: string }[] = [
    { value: "kind", label: "Kind" },
    { value: "name", label: "Name" },
    { value: "color", label: "Color" },
  ];
  const LAYER_COLORS: { value: LayerColor | null; label: string; css: string }[] = [
    { value: null, label: "No Color", css: "transparent" },
    { value: "red", label: "Red", css: "#c93c3c" },
    { value: "orange", label: "Orange", css: "#d07a2d" },
    { value: "yellow", label: "Yellow", css: "#c9b330" },
    { value: "green", label: "Green", css: "#4e9a4e" },
    { value: "blue", label: "Blue", css: "#3c6ec9" },
    { value: "violet", label: "Violet", css: "#8a4fc9" },
    { value: "gray", label: "Gray", css: "#7a7a7a" },
  ];
  const colorCss = (c: LayerColor | null) => LAYER_COLORS.find((x) => x.value === c)?.css ?? "transparent";

  let renaming = $state<LayerId | null>(null);
  let renameText = $state("");
  let list = $state<HTMLDivElement | null>(null);
  let fxAnchor = $state<HTMLButtonElement | null>(null);
  let fxOpen = $state(false);
  let adjAnchor = $state<HTMLButtonElement | null>(null);
  let adjOpen = $state(false);

  // Rename requests from the Layer menu.
  $effect(() => {
    const id = layersUi.renameRequest;
    if (!id || !doc) return;
    const l = doc.layers.find((x) => x.id === id);
    untrack(() => {
      layersUi.renameRequest = null;
      if (l) startRename(l);
    });
  });

  function setProps(layer: Layer, props: Partial<LayerProps>, noMerge = false) {
    docStore.exec(new SetLayerPropsCommand(layer.id, props), { noMerge });
  }

  // ---------------------------------------------------------------- selection

  function selectRow(l: Layer, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (!doc) return;
    const visible = layerRows.map((r) => r.id);
    const r = selectOnClick(visible, layersUi.selectedLayerIds, doc.activeLayerId, l.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    layersUi.setSelection(r.selected);
    layersUi.maskTargeted = false;
    if (r.active !== doc.activeLayerId) docStore.setActiveLayer(r.active);
  }

  function onKey(e: KeyboardEvent, l: Layer) {
    if (e.key === "Enter") selectRow(l, e);
    else if (e.key === "F2") startRename(l);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const i = layerRows.findIndex((r) => r.id === l.id);
      const n = layerRows[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (n) {
        layersUi.setSelection([n.id]);
        docStore.setActiveLayer(n.id);
        (list?.querySelector(`[data-row-id="${n.id}"]`) as HTMLElement | null)?.focus();
      }
    }
  }

  // ---------------------------------------------------------------- eye / solo

  function onEye(e: MouseEvent, l: Layer) {
    e.stopPropagation();
    if (!doc || !entry) return;
    if (e.altKey) {
      const solo = layersUi.solo;
      if (solo && solo.docId === entry.id && solo.layerId === l.id) {
        docStore.exec(new SetLayersVisibleCommand(solo.prev, "Show All Layers"));
        layersUi.solo = null;
        return;
      }
      const prev: Record<LayerId, boolean> = {};
      const next: Record<LayerId, boolean> = {};
      for (const x of doc.layers) {
        prev[x.id] = x.visible;
        next[x.id] = x.id === l.id || x.id === l.parentId || x.parentId === l.id;
      }
      docStore.exec(new SetLayersVisibleCommand(next, "Hide Other Layers"));
      layersUi.solo = { docId: entry.id, layerId: l.id, prev };
      return;
    }
    setProps(l, { visible: !l.visible });
  }

  // ---------------------------------------------------------------- thumbs

  function combineMode(e: MouseEvent): SelectionCombineMode {
    if (e.shiftKey && e.altKey) return "intersect";
    if (e.shiftKey) return "add";
    if (e.altKey) return "subtract";
    return "replace";
  }

  function onThumbClick(e: MouseEvent, l: Layer) {
    if (!doc) return;
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      const s = selectionFromLayer(doc, l.id);
      if (!s) {
        toast.info("Only pixel, shape and type layers have transparency to select.");
        return;
      }
      docStore.exec(new SetSelectionCommand(combineSelections(doc.selection, s, combineMode(e)), "Load Selection"));
      return;
    }
    layersUi.maskTargeted = false;
  }

  function onMaskClick(e: MouseEvent, l: Layer) {
    if (!doc) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      const s = loadMaskAsSelection(doc, l.id, combineMode(e));
      if (s) docStore.exec(new SetSelectionCommand(s, "Load Selection"));
      return;
    }
    if (e.shiftKey) {
      docStore.exec(new SetMaskEnabledCommand(l.id, !l.maskEnabled));
      return;
    }
    if (e.altKey) {
      ui.viewChannel = ui.viewChannel === "mask" ? "rgb" : "mask";
      docStore.touch();
    }
    if (doc.activeLayerId !== l.id) {
      layersUi.setSelection([l.id]);
      docStore.setActiveLayer(l.id);
    }
    layersUi.maskTargeted = true;
  }

  function onThumbDbl(e: MouseEvent, l: Layer) {
    e.stopPropagation();
    if (l.kind === "group") void runCommand("layer.properties");
    else void runCommand("layer.style");
  }

  // ---------------------------------------------------------------- rename

  function startRename(l: Layer) {
    renaming = l.id;
    renameText = l.name;
  }
  function commitRename(l: Layer) {
    if (renaming !== l.id) return;
    renaming = null;
    const name = renameText.trim();
    if (name && name !== l.name) setProps(l, { name }, true);
  }

  // ---------------------------------------------------------------- effects rows

  function setEffectEnabled(l: Layer, key: (typeof EFFECT_ORDER)[number] | "all", on: boolean) {
    const fx = cloneEffects(l.effects);
    if (!fx) return;
    if (key === "all") {
      for (const k of EFFECT_ORDER) if (fx[k]) fx[k]!.enabled = on;
    } else if (fx[key]) {
      fx[key]!.enabled = on;
    }
    docStore.exec(new SetLayerEffectsCommand(l.id, fx, on ? "Show Effects" : "Hide Effects"), { noMerge: true });
  }

  // ---------------------------------------------------------------- context menu

  function menuFor(l: Layer): ContextMenuItem[] {
    if (!doc) return [];
    const st = contextMenuState(doc, l, layersUi.selectedLayerIds);
    const sc = (id: string) => formatShortcut(getCommand(id)?.shortcut, IS_MAC);
    const item = (id: string, label: string, enabled: boolean, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({ label, shortcut: sc(id), disabled: !enabled, run: () => void runCommand(id), ...extra });
    const items: ContextMenuItem[] = [
      item("layer.style", "Blending Options…", st.blendingOptions),
      ...(l.kind === "adjustment" ? [item("layer.editAdjustment", "Edit Adjustment…", true)] : []),
      { separator: true },
      item("layer.duplicate", "Duplicate Layer…", st.duplicate),
      item("layer.delete", "Delete Layer", st.delete),
      { separator: true },
      item("layer.groupFromLayers", "Group from Layers…", st.groupFromLayers),
      { label: "Convert to Smart Object", disabled: true },
      ...(l.kind === "text" ? [item("layer.rasterize.type", "Rasterize Type", st.rasterizeType)] : []),
      ...(l.kind === "shape" ? [item("layer.rasterize.shape", "Rasterize Shape", st.rasterizeShape)] : []),
      { separator: true },
      l.clipToBelow ? item("layer.clipping", "Release Clipping Mask", st.releaseClippingMask) : item("layer.clipping", "Create Clipping Mask", st.createClippingMask),
      item("layer.link", l.linkedTo.length ? "Unlink Layers" : "Link Layers", st.linkLayers || st.unlinkLayers),
      item("layer.selectLinked", "Select Linked Layers", st.selectLinked),
      { separator: true },
      item("layer.style.copy", "Copy Layer Style", !!l.effects),
      item("layer.style.paste", "Paste Layer Style", !!getCommand("layer.style.paste")?.enabled?.()),
      item("layer.style.clear", "Clear Layer Style", !!l.effects),
      { separator: true },
      item("layer.mergeDown", "Merge Down", st.mergeDown),
      item("layer.mergeVisible", "Merge Visible", st.mergeVisible),
      item("layer.flatten", "Flatten Image", st.flatten),
      { separator: true },
      ...LAYER_COLORS.map((c): ContextMenuItem => ({ label: c.label, checked: l.color === c.value, run: () => docStore.exec(new SetLayerPropsCommand(l.id, { color: c.value }, "Layer Color"), { noMerge: true }) })),
    ];
    return items;
  }

  function onContext(e: MouseEvent, l: Layer) {
    e.preventDefault();
    if (!doc) return;
    if (!layersUi.isSelected(l.id, doc.activeLayerId)) {
      layersUi.setSelection([l.id]);
      docStore.setActiveLayer(l.id);
    } else if (doc.activeLayerId !== l.id) docStore.setActiveLayer(l.id);
    contextMenu.open(e.clientX, e.clientY, menuFor(l));
  }

  // ---------------------------------------------------------------- drag reorder

  let drag = $state<{ id: LayerId; alt: boolean; y: number } | null>(null);
  let dropTarget = $state<DropTarget | null>(null);
  let dropLineY = $state<number | null>(null);

  function rowGeoms(): RowGeom[] {
    if (!list || !doc) return [];
    const base = list.getBoundingClientRect().top - list.scrollTop;
    return [...list.querySelectorAll<HTMLElement>("[data-row-id]")].map((el) => {
      const id = el.dataset.rowId!;
      const l = doc.layers.find((x) => x.id === id)!;
      const r = el.getBoundingClientRect();
      return { id, top: r.top - base, height: r.height, isGroup: l.kind === "group", expanded: l.kind === "group" && !l.collapsed, parentId: l.parentId };
    });
  }

  function onRowPointerDown(e: PointerEvent, l: Layer) {
    if (e.button !== 0 || !doc || renaming) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    const el = e.currentTarget as HTMLElement;
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        started = true;
        el.setPointerCapture(e.pointerId);
        drag = { id: l.id, alt: ev.altKey, y: ev.clientY };
      }
      if (!list || !doc) return;
      drag = { id: l.id, alt: ev.altKey, y: ev.clientY };
      const y = ev.clientY - list.getBoundingClientRect().top + list.scrollTop;
      const children = doc.layers.filter((x) => x.parentId === l.id).map((x) => x.id);
      const geoms = rowGeoms();
      const t = computeDrop(geoms, y, l.id, children, l.kind === "group");
      dropTarget = t;
      if (t && t.pos !== "into") {
        const g = geoms.find((x) => x.id === t.id)!;
        dropLineY = t.pos === "above" ? g.top : g.top + g.height;
      } else dropLineY = null;
      // Auto-scroll near the edges.
      const lr = list.getBoundingClientRect();
      if (ev.clientY < lr.top + 12) list.scrollTop -= 6;
      else if (ev.clientY > lr.bottom - 12) list.scrollTop += 6;
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const t = dropTarget;
      const d = drag;
      drag = null;
      dropTarget = null;
      dropLineY = null;
      if (!started) {
        selectRow(l, ev);
        return;
      }
      if (!t || !doc || !d) return;
      let movingId = l.id;
      if (d.alt) {
        const dup = new DuplicateLayerCommand(l.id);
        docStore.exec(dup);
        movingId = dup.copyIds[0] ?? l.id;
      }
      const res = resolveDrop(doc, movingId, t);
      if (res) {
        docStore.exec(new MoveLayerToCommand(movingId, res.toIndex, res.parentId));
        layersUi.setSelection([movingId]);
        docStore.setActiveLayer(movingId);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  // ---------------------------------------------------------------- bottom bar

  const selectedCount = $derived.by(() => {
    if (!doc) return 0;
    void entry?.version;
    const ids = new Set(layersUi.selectedLayerIds);
    if (doc.activeLayerId) ids.add(doc.activeLayerId);
    return ids.size;
  });

  function addMask(e: MouseEvent) {
    const l = active?.layer;
    if (!l) return;
    if (l.mask) {
      toast.info("This layer already has a mask. Vector masks arrive in a later release.");
      return;
    }
    const hide = e.altKey;
    void runCommand(hasSelection ? (hide ? "layer.mask.hideSelection" : "layer.mask.revealSelection") : hide ? "layer.mask.hideAll" : "layer.mask.revealAll");
  }

  function indent(r: PanelRow): number {
    return 4 + r.depth * 14 + (r.clipped ? 14 : 0);
  }
</script>

<div class="layers" style:--thumb-w="{dims.w}px" style:--lrow-h="{rowH}px">
  {#if entry && doc}
    <!-- Filter row -->
    <div class="bar filter">
      <PsSelect value={layersUi.filterMode} choices={FILTER_MODES} width={62} onchange={(v) => layersUi.setFilterMode(v as FilterMode)} />
      {#if layersUi.filterMode === "kind"}
        <span class="kinds">
          {#each KIND_FILTERS as k (k.id)}
            <button type="button" class="kb" class:on={layersUi.kinds.includes(k.id)} disabled={k.disabled} aria-pressed={layersUi.kinds.includes(k.id)} data-tip={k.title} aria-label={k.title} onclick={() => layersUi.toggleKind(k.id)}><Icon name={k.icon} size={14} /></button>
          {/each}
        </span>
      {:else if layersUi.filterMode === "name"}
        <input class="input name-filter" type="text" placeholder="Layer name" bind:value={layersUi.nameFilter} aria-label="Filter by name" onkeydown={(e) => e.stopPropagation()} />
      {:else}
        <span class="kinds">
          {#each LAYER_COLORS as c (c.label)}
            <button type="button" class="kb color" class:on={layersUi.colorFilter === c.value} aria-label={c.label} data-tip={c.label} onclick={() => (layersUi.colorFilter = layersUi.colorFilter === c.value ? null : c.value)}><span class="dot" style:background={c.css} class:none={!c.value}></span></button>
          {/each}
        </span>
      {/if}
      <span class="grow"></span>
      <button type="button" class="switch" class:on={layersUi.filterOn} role="switch" aria-checked={layersUi.filterOn} aria-label="Turn layer filtering on or off" data-tip={layersUi.filterOn ? "Turn layer filtering off" : "Turn layer filtering on"} onclick={() => layersUi.setFilterOn(!layersUi.filterOn)}><span class="knob"></span></button>
    </div>

    <!-- Blend mode + opacity -->
    <div class="bar">
      <PsSelect
        value={active?.isGroup && (active.layer.kind === "group" && active.layer.passThrough) ? "pass-through" : (active?.blendMode ?? "normal")}
        choices={active?.isGroup ? [PASS_THROUGH, ...BLEND_CHOICES] : BLEND_CHOICES}
        width={108}
        disabled={!active}
        onchange={(v) => {
          if (!active) return;
          if (v === "pass-through") setProps(active.layer, { passThrough: true }, true);
          else if (active.isGroup && active.layer.kind === "group" && active.layer.passThrough) docStore.exec(new SetLayerPropsCommand(active.layer.id, { passThrough: false, blendMode: v as BlendMode }, "Blend Mode"), { noMerge: true });
          else setProps(active.layer, { blendMode: v as BlendMode }, true);
        }}
      />
      <span class="grow"></span>
      <ScrubbyNumber label="Opacity" unit="%" min={0} max={100} value={Math.round((active?.opacity ?? 1) * 100)} disabled={!active} width={38} oninput={(v) => active && setProps(active.layer, { opacity: v / 100 })} onchange={(v) => active && setProps(active.layer, { opacity: v / 100 })} />
    </div>

    <!-- Lock + fill -->
    <div class="bar">
      <span class="lbl">Lock:</span>
      <span class="locks">
        <button type="button" class="kb" class:on={active?.lock.transparent} disabled={!active || active.isGroup} data-tip="Lock transparent pixels" aria-label="Lock transparent pixels" onclick={() => active && docStore.exec(new SetLayerLockCommand(active.layer.id, { transparent: !active.lock.transparent }))}><Icon name="lock-transparent" size={14} /></button>
        <button type="button" class="kb" class:on={active?.lock.pixels} disabled={!active || active.isGroup} data-tip="Lock image pixels" aria-label="Lock image pixels" onclick={() => active && docStore.exec(new SetLayerLockCommand(active.layer.id, { pixels: !active.lock.pixels }))}><Icon name="lock-pixels" size={14} /></button>
        <button type="button" class="kb" class:on={active?.lock.position} disabled={!active} data-tip="Lock position" aria-label="Lock position" onclick={() => active && docStore.exec(new SetLayerLockCommand(active.layer.id, { position: !active.lock.position }))}><Icon name="lock-position" size={14} /></button>
        <button type="button" class="kb" class:on={active?.lock.all} disabled={!active} data-tip="Lock all" aria-label="Lock all" onclick={() => active && docStore.exec(new SetLayerLockCommand(active.layer.id, { all: !active.lock.all }))}><Icon name="lock-all" size={14} /></button>
      </span>
      <span class="grow"></span>
      <ScrubbyNumber label="Fill" unit="%" min={0} max={100} value={Math.round((active?.fill ?? 1) * 100)} disabled={!active || active.isGroup} width={38} oninput={(v) => active && setProps(active.layer, { fillOpacity: v / 100 })} onchange={(v) => active && setProps(active.layer, { fillOpacity: v / 100 })} />
    </div>

    <!-- Rows -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="list" role="listbox" aria-label="Layers" aria-multiselectable="true" tabindex="-1" bind:this={list}>
      {#each rows as r (r.id)}
        {#if r.kind === "layer"}
          {@const l = r.layer}
          <div
            class="row"
            class:selected={r.selected}
            class:active={r.active}
            class:hidden={!r.visible}
            class:dragging={drag?.id === l.id}
            class:drop-into={dropTarget?.pos === "into" && dropTarget.id === l.id}
            data-row-id={l.id}
            role="option"
            aria-selected={r.selected}
            tabindex="0"
            style:padding-left="{indent(r)}px"
            onkeydown={(e) => onKey(e, l)}
            oncontextmenu={(e) => onContext(e, l)}
            onpointerdown={(e) => onRowPointerDown(e, l)}
          >
            <span class="eyecell" style:background={colorCss(r.color)}>
              <button type="button" class="eye" class:off={!r.visible} aria-label={r.visible ? "Hide layer" : "Show layer"} data-tip="Indicates layer visibility" onclick={(e) => onEye(e, l)}>
                <Icon name={r.visible ? "eye" : "eye-off"} size={14} />
              </button>
            </span>
            {#if r.clipped}
              <span class="clip" aria-hidden="true"><Icon name="clip-arrow" size={12} /></span>
            {/if}
            {#if r.isGroup}
              <button type="button" class="disc" aria-label={r.collapsed ? "Expand group" : "Collapse group"} onclick={(e) => { e.stopPropagation(); setProps(l, { collapsed: !r.collapsed }, true); }}>
                <Icon name={r.collapsed ? "chevron-right" : "chevron-down"} size={10} />
              </button>
            {/if}
            {#if layersUi.thumbSize !== "none"}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <span class="cell" role="button" tabindex="-1" aria-label="Layer thumbnail" onclick={(e) => onThumbClick(e, l)} ondblclick={(e) => onThumbDbl(e, l)}>
                <LayerThumb layer={l} docW={doc.width} docH={doc.height} w={dims.w} h={dims.h} version={entry.pixelVersion} contents={layersUi.thumbContents} framed={r.active && !(layersUi.maskTargeted && r.hasMask)} />
              </span>
              {#if r.hasMask}
                <button type="button" class="chain" class:off={!l.maskLinked} aria-label={l.maskLinked ? "Unlink layer and mask" : "Link layer and mask"} data-tip={l.maskLinked ? "Indicates layer mask is linked to layer" : "Layer mask is unlinked"} onclick={(e) => { e.stopPropagation(); docStore.exec(new SetMaskLinkedCommand(l.id, !l.maskLinked)); }}>
                  <Icon name={l.maskLinked ? "chain" : "chain-off"} size={12} />
                </button>
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span class="cell" role="button" tabindex="-1" aria-label="Layer mask thumbnail" onclick={(e) => onMaskClick(e, l)} ondblclick={(e) => { e.stopPropagation(); layersUi.maskTargeted = true; ui.activateTab("properties"); }}>
                  <LayerThumb layer={l} docW={doc.width} docH={doc.height} w={dims.w} h={dims.h} version={entry.pixelVersion} mode="mask" framed={r.active && layersUi.maskTargeted} disabled={!r.maskEnabled} />
                </span>
              {/if}
            {/if}
            {#if renaming === l.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="rename" type="text" bind:value={renameText} autofocus onblur={() => commitRename(l)} onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRename(l); if (e.key === "Escape") renaming = null; }} onpointerdown={(e) => e.stopPropagation()} />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="name" class:base={baseIds.has(l.id)} class:kind-type={l.kind === "text"} title={r.name} ondblclick={(e) => { e.stopPropagation(); startRename(l); }}>{r.name}</span>
            {/if}
            {#if r.hasEffects}
              <button type="button" class="fx" aria-label={r.effectsExpanded ? "Collapse effects" : "Expand effects"} data-tip="Indicates layer effects" onclick={(e) => { e.stopPropagation(); layersUi.toggleEffectsExpanded(l.id); }}>
                <span class="fxt">fx</span><Icon name={r.effectsExpanded ? "chevron-up" : "chevron-down"} size={8} />
              </button>
            {/if}
            {#if r.anyLock}
              <span class="lockg" aria-label="Locked" data-tip={r.locked ? "Indicates layer is fully locked" : "Indicates layer is partially locked"}><Icon name={r.locked ? "lock" : "unlock"} size={12} /></span>
            {/if}
          </div>
        {:else if r.kind === "effects"}
          <div class="row sub head">
            <span class="eyecell"><button type="button" class="eye" class:off={!r.visible} aria-label={r.visible ? "Hide all effects" : "Show all effects"} onclick={() => setEffectEnabled(r.layer, "all", !r.visible)}><Icon name={r.visible ? "eye" : "eye-off"} size={14} /></button></span>
            <span class="name" style:padding-left="{indent(r) + dims.w + 18}px">Effects</span>
          </div>
        {:else}
          <div class="row sub">
            <span class="eyecell"><button type="button" class="eye" class:off={!r.visible} aria-label={r.visible ? `Hide ${r.label}` : `Show ${r.label}`} onclick={() => setEffectEnabled(r.layer, r.effect, !r.visible)}><Icon name={r.visible ? "eye" : "eye-off"} size={14} /></button></span>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="name" style:padding-left="{indent(r) + dims.w + 18}px" ondblclick={() => void runCommand(`layer.style.${r.effect}`)}>{r.label}</span>
          </div>
        {/if}
      {/each}
      {#if dropLineY !== null}
        <div class="dropline" style:top="{dropLineY}px"></div>
      {/if}
      {#if rows.length === 0}
        <div class="empty">No layers match the filter.</div>
      {/if}
    </div>

    <!-- Bottom bar -->
    <div class="footer">
      <button type="button" class="fb" data-tip="Link layers" aria-label="Link layers" disabled={selectedCount < 2 && !(active?.layer.linkedTo.length)} onclick={() => void runCommand("layer.link")}><Icon name="link" size={16} /></button>
      <button type="button" class="fb" bind:this={fxAnchor} data-tip="Add a layer style" aria-label="Add a layer style" disabled={!active || active.isGroup} onclick={() => (fxOpen = !fxOpen)}><span class="fxt big">fx</span><Icon name="caret-small" size={10} /></button>
      <button type="button" class="fb" data-tip="Add layer mask" aria-label="Add layer mask" disabled={!active} onclick={addMask}><Icon name="mask" size={16} /></button>
      <button type="button" class="fb" bind:this={adjAnchor} data-tip="Create new fill or adjustment layer" aria-label="Create new fill or adjustment layer" onclick={() => (adjOpen = !adjOpen)}><Icon name="adjustment" size={16} /><Icon name="caret-small" size={10} /></button>
      <button type="button" class="fb" data-tip="Create a new group" aria-label="Create a new group" onclick={() => void runCommand(selectedCount > 1 ? "layer.groupFromLayers" : "layer.newGroup")}><Icon name="folder" size={16} /></button>
      <button type="button" class="fb" data-tip="Create a new layer" aria-label="Create a new layer" onclick={(e) => void runCommand(e.altKey ? "layer.new" : "layer.newQuick")}><Icon name="new-layer" size={16} /></button>
      <button type="button" class="fb" data-tip="Delete layer" aria-label="Delete layer" disabled={layerCount <= selectedCount} onclick={() => void runCommand("layer.delete")}><Icon name="trash" size={16} /></button>
    </div>

    <Popover anchor={fxAnchor} open={fxOpen} onclose={() => (fxOpen = false)} up minWidth={170}>
      <div class="pmenu" role="menu">
        <button type="button" class="pitem" role="menuitem" onclick={() => { fxOpen = false; void runCommand("layer.style"); }}>Blending Options…</button>
        <div class="psep"></div>
        {#each EFFECT_ORDER as k (k)}
          <button type="button" class="pitem" role="menuitem" onclick={() => { fxOpen = false; void runCommand(`layer.style.${k}`); }}>{EFFECT_LABEL[k]}…</button>
        {/each}
      </div>
    </Popover>
    <Popover anchor={adjAnchor} open={adjOpen} onclose={() => (adjOpen = false)} up minWidth={170}>
      <div class="pmenu" role="menu">
        {#each FILL_MENU as f (f.id)}
          <button type="button" class="pitem" role="menuitem" onclick={() => { adjOpen = false; void runCommand(f.id); }}>{f.label}</button>
        {/each}
        <div class="psep"></div>
        {#each ADJUSTMENT_MENU as a (a.id)}
          <button type="button" class="pitem" role="menuitem" onclick={() => { adjOpen = false; void runCommand(a.id); }}>{a.label}</button>
        {/each}
      </div>
    </Popover>
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
    font-size: var(--fs-sm);
    color: var(--ps-text);
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 6px;
    border-bottom: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 -1px 0 var(--ps-border-light);
  }
  .bar.filter {
    gap: 3px;
  }
  .grow {
    flex: 1;
  }
  .lbl {
    color: var(--ps-text-dim);
  }
  .kinds,
  .locks {
    display: inline-flex;
    gap: 1px;
  }
  .kb {
    display: grid;
    place-items: center;
    width: 20px;
    height: 18px;
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .kb:hover:not(:disabled) {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .kb.on {
    background: var(--ps-active);
    color: var(--ps-text);
    box-shadow: inset 0 0 0 1px var(--ps-border-dark);
  }
  .kb:disabled {
    opacity: 0.35;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid var(--ps-border-dark);
  }
  .dot.none {
    background: linear-gradient(135deg, transparent 45%, #d04040 45%, #d04040 55%, transparent 55%);
  }
  .name-filter {
    width: 110px;
  }
  .switch {
    position: relative;
    width: 22px;
    height: 12px;
    border-radius: 6px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
  }
  .switch .knob {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ps-text-dim);
    transition: left var(--t-fast);
  }
  .switch.on {
    background: var(--ps-accent);
    border-color: #0d5bbd;
  }
  .switch.on .knob {
    left: 11px;
    background: #fff;
  }

  .list {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--ps-panel);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--lrow-h);
    padding-right: 6px;
    border-bottom: 1px solid var(--ps-border-dark);
    color: var(--ps-text);
    white-space: nowrap;
    outline: none;
  }
  .row:hover {
    background: var(--ps-hover);
  }
  .row.selected {
    background: var(--ps-row-selected-inactive);
  }
  .row.active {
    background: var(--ps-row-selected);
  }
  .row.hidden .name {
    color: var(--ps-text-dim);
  }
  .row.dragging {
    opacity: 0.45;
  }
  .row.drop-into {
    box-shadow: inset 0 0 0 2px var(--ps-accent);
  }
  .row.sub {
    height: 22px;
    gap: 0;
    color: var(--ps-text-dim);
  }
  .row.sub .eyecell {
    border-right: 0;
  }
  .row.sub.head {
    color: var(--ps-text);
  }
  .row:focus-visible {
    box-shadow: inset 0 0 0 1px var(--ps-accent);
  }
  .eyecell {
    align-self: stretch;
    display: grid;
    place-items: center;
    width: 22px;
    margin-left: -4px;
    margin-right: 2px;
    border-right: 1px solid var(--ps-border-dark);
  }
  .eye,
  .chain,
  .disc,
  .fx {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 2px;
    color: var(--ps-text);
    flex: none;
  }
  .eye.off {
    color: transparent;
  }
  .eye.off:hover,
  .row:hover .eye.off {
    color: var(--ps-text-disabled);
  }
  .chain {
    width: 14px;
    color: var(--ps-text-dim);
  }
  .chain.off {
    color: var(--ps-text-disabled);
  }
  .clip {
    display: grid;
    place-items: center;
    width: 14px;
    color: var(--ps-text-dim);
    flex: none;
  }
  .disc {
    width: 12px;
    color: var(--ps-text-dim);
  }
  .cell {
    display: inline-flex;
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-left: 2px;
  }
  .name.base {
    text-decoration: underline;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 18px;
    padding: 0 3px;
    font: inherit;
    background: var(--ps-input);
    border: 1px solid var(--ps-accent);
    border-radius: 2px;
    color: var(--ps-text);
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }
  .fx {
    width: auto;
    gap: 1px;
    padding: 0 3px;
    color: var(--ps-text);
  }
  .fx:hover {
    background: var(--ps-hover);
  }
  .fxt {
    font-style: italic;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: -0.5px;
  }
  .fxt.big {
    font-size: 12px;
  }
  .lockg {
    display: grid;
    place-items: center;
    width: 16px;
    color: var(--ps-text-dim);
  }
  .dropline {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    margin-top: -1px;
    background: var(--ps-accent);
    pointer-events: none;
    z-index: 2;
  }
  .footer {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    height: 24px;
    padding: 0 4px;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .fb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 20px;
    padding: 0 2px;
    border-radius: 2px;
    color: var(--ps-text);
  }
  .fb:hover:not(:disabled) {
    background: var(--ps-hover);
  }
  .fb:disabled {
    opacity: 0.35;
  }
  .pmenu {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .pitem {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 14px 0 10px;
    text-align: left;
    white-space: nowrap;
    color: var(--ps-text);
  }
  .pitem:hover {
    background: var(--ps-row-selected);
  }
  .psep {
    height: 1px;
    margin: 3px 0;
    background: var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
  }
  .empty {
    padding: 14px 10px;
    color: var(--ps-text-dim);
  }
</style>
