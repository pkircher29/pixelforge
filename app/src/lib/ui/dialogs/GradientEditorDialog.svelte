<script lang="ts">
  /**
   * Gradient Editor (PS layout): presets grid, Name + New, Smoothness, gradient bar with
   * opacity stops above / colour stops below (click empty area = add, drag = move, drag off
   * = delete, Alt-drag = duplicate, double-click colour stop = colour picker), midpoint
   * diamonds, Stops group (Opacity / Color / Location %), Load / Save JSON.
   */
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { toolStore, rgbaToHex, hexToRgba } from "$lib/stores/tool.svelte";
  import {
    addColorStop,
    addOpacityStop,
    cloneGradientDef,
    moveColorStop,
    moveOpacityStop,
    removeColorStop,
    removeOpacityStop,
    resolveColor,
    setColorMidpoint,
    setColorStop,
    setOpacityMidpoint,
    setOpacityStop,
    type GradientDef,
  } from "$lib/tools/gradient-model";
  import { DEFAULT_GRADIENTS, loadUserGradients, saveUserGradients } from "$lib/tools/gradient-presets";
  import { drawGradientBar } from "$lib/tools/ui/gradient-draw";

  interface Props {
    initial: GradientDef;
    resolve: Resolver<GradientDef>;
  }
  let { initial, resolve }: Props = $props();

  // svelte-ignore state_referenced_locally
  let def = $state<GradientDef>(cloneGradientDef(initial));
  let userList = $state<GradientDef[]>(loadUserGradients());
  let sel = $state<{ kind: "color" | "opacity"; index: number } | null>({ kind: "color", index: 0 });
  let bar = $state<HTMLCanvasElement | null>(null);
  let track = $state<HTMLDivElement | null>(null);
  let colorInput = $state<HTMLInputElement | null>(null);
  const fg = toolStore.fg;
  const bg = toolStore.bg;
  const presets = $derived([...DEFAULT_GRADIENTS, ...userList]);

  $effect(() => {
    void def;
    if (bar) drawGradientBar(bar, def, fg, bg);
  });

  function preview(el: HTMLCanvasElement, g: GradientDef) {
    const draw = () => drawGradientBar(el, g, fg, bg);
    draw();
    return { update: draw };
  }

  function posFromEvent(e: PointerEvent): number {
    const r = track!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  function startDrag(kind: "color" | "opacity", index: number, e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.altKey) {
      // Alt-drag duplicates the stop.
      if (kind === "color") {
        const s = def.colorStops[index]!;
        const r = addColorStop(def, s.pos, s.color);
        def = r.def;
        index = r.index;
      } else {
        const s = def.opacityStops[index]!;
        const r = addOpacityStop(def, s.pos, s.alpha);
        def = r.def;
        index = r.index;
      }
    }
    sel = { kind, index };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let off = false;
    const move = (ev: PointerEvent) => {
      off = Math.abs(ev.clientY - startY) > 30;
      const p = posFromEvent(ev);
      def = kind === "color" ? moveColorStop(def, index, p) : moveOpacityStop(def, index, p);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (off) {
        // Drag off the bar deletes the stop (min 2 stay).
        def = kind === "color" ? removeColorStop(def, index) : removeOpacityStop(def, index);
        sel = null;
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function startMid(kind: "color" | "opacity", index: number, e: PointerEvent) {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const stops = kind === "color" ? sortedIdx(def.colorStops) : sortedIdx(def.opacityStops);
    const k = stops.indexOf(index);
    const nextIdx = stops[k + 1];
    if (nextIdx === undefined) return;
    const move = (ev: PointerEvent) => {
      const a = kind === "color" ? def.colorStops[index]!.pos : def.opacityStops[index]!.pos;
      const b = kind === "color" ? def.colorStops[nextIdx]!.pos : def.opacityStops[nextIdx]!.pos;
      const p = posFromEvent(ev);
      const mid = b === a ? 0.5 : (p - a) / (b - a);
      def = kind === "color" ? setColorMidpoint(def, index, mid) : setOpacityMidpoint(def, index, mid);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function sortedIdx<T extends { pos: number }>(arr: T[]): number[] {
    return arr.map((_, i) => i).sort((a, b) => arr[a]!.pos - arr[b]!.pos);
  }

  function addAt(kind: "color" | "opacity", e: PointerEvent) {
    const p = posFromEvent(e);
    if (kind === "color") {
      const r = addColorStop(def, p);
      def = r.def;
      sel = { kind, index: r.index };
    } else {
      const r = addOpacityStop(def, p);
      def = r.def;
      sel = { kind, index: r.index };
    }
  }

  const selColor = $derived(sel?.kind === "color" ? def.colorStops[sel.index] : undefined);
  const selOpacity = $derived(sel?.kind === "opacity" ? def.opacityStops[sel.index] : undefined);
  const selPos = $derived(selColor?.pos ?? selOpacity?.pos ?? 0);

  function setLocation(v: number) {
    if (!sel || !Number.isFinite(v)) return;
    const p = Math.max(0, Math.min(100, v)) / 100;
    def = sel.kind === "color" ? moveColorStop(def, sel.index, p) : moveOpacityStop(def, sel.index, p);
  }
  function setColorHex(hex: string) {
    const c = hexToRgba(hex);
    if (c && sel?.kind === "color") def = setColorStop(def, sel.index, c);
  }
  function deleteSel() {
    if (!sel) return;
    def = sel.kind === "color" ? removeColorStop(def, sel.index) : removeOpacityStop(def, sel.index);
    sel = null;
  }
  function stopHex(c: GradientDef["colorStops"][number]["color"]): string {
    return rgbaToHex(resolveColor(c, fg, bg));
  }

  function newPreset() {
    const g = { ...cloneGradientDef(def), id: `user-${Date.now().toString(36)}`, name: def.name || "Custom" };
    userList = [...userList, g];
    saveUserGradients(userList);
    def = cloneGradientDef(g);
  }
  function deletePreset(id: string) {
    userList = userList.filter((g) => g.id !== id);
    saveUserGradients(userList);
  }
  function saveFile() {
    const blob = new Blob([JSON.stringify({ pixelforgeGradients: 1, gradients: [def, ...userList] }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${def.name || "gradients"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function loadFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        const o = JSON.parse(await f.text()) as { gradients?: GradientDef[] } | GradientDef[];
        const list = Array.isArray(o) ? o : (o.gradients ?? []);
        const valid = list.filter((g) => g && Array.isArray(g.colorStops) && Array.isArray(g.opacityStops)).map((g) => ({ ...g, id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }));
        userList = [...userList, ...valid];
        saveUserGradients(userList);
      } catch {
        /* invalid file: ignore */
      }
    };
    inp.click();
  }
  function ok() {
    resolve(cloneGradientDef(def));
  }
</script>

<Dialog title="Gradient Editor" width={520} oncancel={() => resolve(null)} onsubmit={ok}>
  <div class="layout">
    <div class="left">
      <div class="glabel">Presets</div>
      <div class="presets">
        {#each presets as g (g.id)}
          <button type="button" class="cell" class:on={g.id === def.id} title={g.name} oncontextmenu={(e) => { e.preventDefault(); if (g.id.startsWith("user-")) deletePreset(g.id); }} onclick={() => { def = cloneGradientDef(g); sel = { kind: "color", index: 0 }; }}>
            <canvas use:preview={g}></canvas>
          </button>
        {/each}
      </div>
      <div class="namerow">
        <label class="lab" for="gname">Name:</label>
        <input id="gname" class="input" type="text" bind:value={def.name} />
        <button type="button" class="btn sm" onclick={newPreset}>New</button>
      </div>
      <div class="namerow">
        <span class="lab">Gradient Type: Solid</span>
        <span class="grow"></span>
        <label class="lab" for="gsmooth">Smoothness:</label>
        <input id="gsmooth" class="input num" type="number" min="0" max="100" bind:value={def.smoothness} />
        <span class="lab">%</span>
      </div>

      <div class="editor" bind:this={track}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane top" onpointerdown={(e) => addAt("opacity", e)} title="Click to add an opacity stop">
          {#each def.opacityStops as s, i (i)}
            <button type="button" class="stop op" class:on={sel?.kind === "opacity" && sel.index === i} style:left="{s.pos * 100}%" style:--g="{Math.round(255 * (1 - s.alpha))}" aria-label="Opacity stop {Math.round(s.alpha * 100)}%" onpointerdown={(e) => startDrag("opacity", i, e)}></button>
          {/each}
          {#if sel?.kind === "opacity"}
            {@const order = sortedIdx(def.opacityStops)}
            {@const k = order.indexOf(sel.index)}
            {#if k >= 0 && k < order.length - 1}
              {@const a = def.opacityStops[sel.index]!}
              {@const b = def.opacityStops[order[k + 1]!]!}
              <button type="button" class="mid up" style:left="{(a.pos + (b.pos - a.pos) * a.mid) * 100}%" aria-label="Opacity midpoint" onpointerdown={(e) => startMid("opacity", sel!.index, e)}></button>
            {/if}
          {/if}
        </div>
        <canvas class="bar" bind:this={bar}></canvas>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane bottom" onpointerdown={(e) => addAt("color", e)} title="Click to add a colour stop">
          {#each def.colorStops as s, i (i)}
            <button type="button" class="stop col" class:on={sel?.kind === "color" && sel.index === i} style:left="{s.pos * 100}%" style:--c={stopHex(s.color)} aria-label="Colour stop" onpointerdown={(e) => startDrag("color", i, e)} ondblclick={() => colorInput?.click()}></button>
          {/each}
          {#if sel?.kind === "color"}
            {@const order = sortedIdx(def.colorStops)}
            {@const k = order.indexOf(sel.index)}
            {#if k >= 0 && k < order.length - 1}
              {@const a = def.colorStops[sel.index]!}
              {@const b = def.colorStops[order[k + 1]!]!}
              <button type="button" class="mid" style:left="{(a.pos + (b.pos - a.pos) * a.mid) * 100}%" aria-label="Colour midpoint" onpointerdown={(e) => startMid("color", sel!.index, e)}></button>
            {/if}
          {/if}
        </div>
      </div>

      <fieldset class="ps-group stops">
        <legend>Stops</legend>
        <div class="srow">
          <span class="lab">Opacity:</span>
          <input class="input num" type="number" min="0" max="100" disabled={!selOpacity} value={selOpacity ? Math.round(selOpacity.alpha * 100) : ""} onchange={(e) => sel && def.opacityStops[sel.index] && (def = setOpacityStop(def, sel.index, Number(e.currentTarget.value) / 100))} />
          <span class="lab">%</span>
          <span class="lab sp">Location:</span>
          <input class="input num" type="number" min="0" max="100" disabled={!selOpacity} value={selOpacity ? Math.round(selPos * 100) : ""} onchange={(e) => setLocation(Number(e.currentTarget.value))} />
          <span class="lab">%</span>
          <button type="button" class="btn sm" disabled={!selOpacity || def.opacityStops.length <= 2} onclick={deleteSel}>Delete</button>
        </div>
        <div class="srow">
          <span class="lab">Color:</span>
          <span class="swatch" class:dis={!selColor} style:background={selColor ? stopHex(selColor.color) : "transparent"}>
            <input bind:this={colorInput} type="color" disabled={!selColor} value={selColor ? stopHex(selColor.color) : "#000000"} oninput={(e) => setColorHex(e.currentTarget.value)} aria-label="Stop colour" />
          </span>
          <button type="button" class="btn sm" disabled={!selColor} onclick={() => sel && (def = setColorStop(def, sel.index, "fg"))} title="Use the foreground colour">FG</button>
          <button type="button" class="btn sm" disabled={!selColor} onclick={() => sel && (def = setColorStop(def, sel.index, "bg"))} title="Use the background colour">BG</button>
          <span class="lab sp">Location:</span>
          <input class="input num" type="number" min="0" max="100" disabled={!selColor} value={selColor ? Math.round(selPos * 100) : ""} onchange={(e) => setLocation(Number(e.currentTarget.value))} />
          <span class="lab">%</span>
          <button type="button" class="btn sm" disabled={!selColor || def.colorStops.length <= 2} onclick={deleteSel}>Delete</button>
        </div>
      </fieldset>
    </div>
    <div class="right">
      <button type="button" class="btn primary" onclick={ok}>OK</button>
      <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
      <button type="button" class="btn" onclick={loadFile}>Load…</button>
      <button type="button" class="btn" onclick={saveFile}>Save…</button>
    </div>
  </div>
</Dialog>

<style>
  .layout {
    display: flex;
    gap: 14px;
  }
  .left {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 84px;
  }
  .right .btn {
    width: 100%;
  }
  .glabel,
  .lab {
    color: var(--ps-text-dim);
    white-space: nowrap;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
    padding: 4px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    max-height: 96px;
    overflow: auto;
  }
  .cell {
    height: 26px;
    padding: 1px;
    border: 1px solid var(--ps-border-dark);
  }
  .cell.on {
    border-color: var(--ps-accent);
    box-shadow: 0 0 0 1px var(--ps-accent);
  }
  .cell canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .namerow,
  .srow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .namerow .input[type="text"] {
    flex: 1;
  }
  .grow {
    flex: 1;
  }
  .num {
    width: 48px;
  }
  .sp {
    margin-left: 8px;
  }
  .editor {
    position: relative;
    margin: 4px 8px;
  }
  .lane {
    position: relative;
    height: 16px;
    cursor: copy;
  }
  .bar {
    display: block;
    width: 100%;
    height: 26px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: 0 0 0 1px var(--ps-border-light);
  }
  .stop {
    position: absolute;
    width: 11px;
    height: 14px;
    margin-left: -5.5px;
    padding: 0;
    cursor: ew-resize;
  }
  /* Colour stops: house shape pointing up at the bar, filled with the stop colour. */
  .stop.col {
    top: 1px;
    background: var(--c);
    clip-path: polygon(50% 0, 100% 35%, 100% 100%, 0 100%, 0 35%);
    box-shadow: inset 0 0 0 1px #000;
  }
  .stop.op {
    bottom: 1px;
    background: rgb(var(--g), var(--g), var(--g));
    clip-path: polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%);
  }
  .stop::after {
    content: "";
    position: absolute;
    inset: 0;
    outline: 1px solid #000;
  }
  .stop.on {
    filter: drop-shadow(0 0 1px var(--ps-accent)) drop-shadow(0 0 1px var(--ps-accent));
  }
  .stop.col.on {
    box-shadow: inset 0 0 0 2px var(--ps-accent);
  }
  .mid {
    position: absolute;
    top: 3px;
    width: 7px;
    height: 7px;
    margin-left: -3.5px;
    padding: 0;
    background: var(--ps-text);
    transform: rotate(45deg);
    cursor: ew-resize;
  }
  .mid.up {
    top: 6px;
  }
  .stops {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .stops legend {
    color: var(--ps-text-dim);
    padding: 0 4px;
  }
  .swatch {
    position: relative;
    width: 34px;
    height: 18px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
  .swatch.dis {
    opacity: 0.4;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
  }
</style>
