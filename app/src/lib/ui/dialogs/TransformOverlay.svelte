<script lang="ts">
  /**
   * Free Transform overlay. Mounted once on `document.body` by `filters/register.ts`;
   * renders nothing until `transformSession.active`.
   *
   * The floating pixels are drawn in a `<canvas>` placed with a CSS matrix (doc -> screen
   * via the active viewport, times the session matrix), so dragging is free of resampling.
   * Note: the preview composites with normal blending over everything; the layer's blend
   * mode only applies once committed.
   *
   * Shell assumption: the document canvas is `canvas[aria-label="Document canvas"]`
   * (falls back to the largest canvas on the page) and `viewport.docToScreen` yields CSS
   * px relative to that element.
   */
  import { onMount } from "svelte";
  import type { Point } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { Mat } from "$lib/filters/transform/affine";
  import { transformSession as session } from "$lib/filters/transform/session.svelte";

  type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
  type Mode = "move" | "scale" | "rotate";

  const HANDLES: { id: Handle; hx: number; hy: number }[] = [
    { id: "nw", hx: -1, hy: -1 },
    { id: "n", hx: 0, hy: -1 },
    { id: "ne", hx: 1, hy: -1 },
    { id: "e", hx: 1, hy: 0 },
    { id: "se", hx: 1, hy: 1 },
    { id: "s", hx: 0, hy: 1 },
    { id: "sw", hx: -1, hy: 1 },
    { id: "w", hx: -1, hy: 0 },
  ];

  let tick = $state(0);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let drag = $state<Mode | null>(null);

  // ----------------------------------------------------------------- screen mapping

  function docCanvasRect(): DOMRect {
    const el =
      document.querySelector<HTMLCanvasElement>('canvas[aria-label="Document canvas"]') ??
      Array.from(document.querySelectorAll("canvas"))
        .filter((c) => !c.closest(".pf-transform-overlay"))
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    return el ? el.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  /** Doc -> window CSS px matrix for the active viewport. */
  function docToScreenMat(): Mat {
    const entry = docStore.active;
    const r = docCanvasRect();
    if (!entry) return Mat.translate(r.left, r.top);
    const v = entry.viewport;
    const c = Math.cos(v.rotation) * v.zoom;
    const s = Math.sin(v.rotation) * v.zoom;
    return [c, s, -s, c, v.panX + r.left, v.panY + r.top];
  }

  const view = $derived.by(() => {
    void tick;
    void session.params;
    if (!session.active) return null;
    const d2s = docToScreenMat();
    const corners = session.corners().map((p) => Mat.apply(d2s, p)) as [Point, Point, Point, Point];
    const cx = (corners[0].x + corners[2].x) / 2;
    const cy = (corners[0].y + corners[2].y) / 2;
    const handles = HANDLES.map((h) => {
      // Interpolate on the quad: hx, hy in -1..1.
      const u = (h.hx + 1) / 2;
      const v = (h.hy + 1) / 2;
      const top = { x: corners[0].x + (corners[1].x - corners[0].x) * u, y: corners[0].y + (corners[1].y - corners[0].y) * u };
      const bot = { x: corners[3].x + (corners[2].x - corners[3].x) * u, y: corners[3].y + (corners[2].y - corners[3].y) * u };
      return { ...h, x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
    });
    const f = session.floatingRaster;
    const css = Mat.toCss(Mat.mul(d2s, session.matrix));
    const bounds = session.bounds;
    return { corners, cx, cy, handles, css, w: f?.width ?? 0, h: f?.height ?? 0, bounds };
  });

  // Keep the overlay in sync with pan/zoom while active.
  $effect(() => {
    if (!session.active) return;
    let raf = 0;
    const loop = (): void => {
      tick++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  // Upload the floating pixels to the preview canvas whenever they change.
  $effect(() => {
    void session.floatingVersion;
    const el = previewCanvas;
    const f = session.floatingRaster;
    if (!el || !f || !session.active) return;
    el.width = f.width;
    el.height = f.height;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(f.toImageData(), 0, 0);
  });

  // ----------------------------------------------------------------- pointer handling

  interface DragState {
    mode: Mode;
    handle?: { hx: number; hy: number };
    start: Point;
    startDoc: Point;
    startParams: { tx: number; ty: number; sx: number; sy: number; angle: number };
    startAngle: number;
  }
  let ds: DragState | null = null;

  function screenToDoc(p: Point): Point {
    return Mat.apply(Mat.invert(docToScreenMat()), p);
  }

  function pointInQuad(p: Point, q: [Point, Point, Point, Point]): boolean {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i]!;
      const b = q[(i + 1) % 4]!;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      const s = Math.sign(cross);
      if (s === 0) continue;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  function hitTest(p: Point): { mode: Mode; handle?: { hx: number; hy: number } } | null {
    const v = view;
    if (!v) return null;
    for (const h of v.handles) {
      if (Math.hypot(p.x - h.x, p.y - h.y) <= 8) return { mode: "scale", handle: { hx: h.hx, hy: h.hy } };
    }
    if (pointInQuad(p, v.corners)) return { mode: "move" };
    for (const c of v.corners) if (Math.hypot(p.x - c.x, p.y - c.y) <= 28) return { mode: "rotate" };
    return null;
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0 || !session.active) return;
    const p = { x: e.clientX, y: e.clientY };
    const hit = hitTest(p);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const v = view!;
    const c = session.params;
    ds = {
      mode: hit.mode,
      ...(hit.handle ? { handle: hit.handle } : {}),
      start: p,
      startDoc: screenToDoc(p),
      startParams: { tx: c.tx, ty: c.ty, sx: c.sx, sy: c.sy, angle: c.angle },
      startAngle: Math.atan2(p.y - v.cy, p.x - v.cx),
    };
    drag = hit.mode;
  }

  function onMove(e: PointerEvent): void {
    if (!ds) {
      cursor = cursorFor(hitTest({ x: e.clientX, y: e.clientY }), { x: e.clientX, y: e.clientY });
      return;
    }
    const p = { x: e.clientX, y: e.clientY };
    const sp = ds.startParams;
    const f = session.floatingRaster;
    if (!f) return;
    if (ds.mode === "move") {
      const d = screenToDoc(p);
      let dx = d.x - ds.startDoc.x;
      let dy = d.y - ds.startDoc.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      session.params.tx = sp.tx + dx;
      session.params.ty = sp.ty + dy;
      return;
    }
    if (ds.mode === "rotate") {
      const v = view!;
      const a = Math.atan2(p.y - v.cy, p.x - v.cx);
      let deg = sp.angle + ((a - ds.startAngle) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      session.params.angle = ((((deg + 180) % 360) + 360) % 360) - 180;
      return;
    }
    // Scale: work in the floating raster's local (unrotated) frame.
    const h = ds.handle!;
    const origin = session.floatingOrigin;
    const cx0 = origin.x + f.width / 2 + sp.tx;
    const cy0 = origin.y + f.height / 2 + sp.ty;
    const rot = Mat.rotate((sp.angle * Math.PI) / 180);
    const inv = Mat.invert(rot);
    const d = screenToDoc(p);
    const l = Mat.apply(inv, { x: d.x - cx0, y: d.y - cy0 });
    const halfW = (f.width * sp.sx) / 2;
    const halfH = (f.height * sp.sy) / 2;
    const fromCenter = e.altKey;
    let sx = sp.sx;
    let sy = sp.sy;
    let shiftX = 0;
    let shiftY = 0;
    if (h.hx !== 0) {
      const anchor = fromCenter ? 0 : -h.hx * halfW;
      const newW = (l.x - anchor) * h.hx * (fromCenter ? 2 : 1);
      sx = newW / f.width;
      if (!fromCenter) shiftX = anchor + (newW * h.hx) / 2;
    }
    if (h.hy !== 0) {
      const anchor = fromCenter ? 0 : -h.hy * halfH;
      const newH = (l.y - anchor) * h.hy * (fromCenter ? 2 : 1);
      sy = newH / f.height;
      if (!fromCenter) shiftY = anchor + (newH * h.hy) / 2;
    }
    if (e.shiftKey && h.hx !== 0 && h.hy !== 0) {
      const k = (Math.abs(sx / sp.sx) + Math.abs(sy / sp.sy)) / 2;
      sx = Math.sign(sx || 1) * Math.abs(sp.sx) * k;
      sy = Math.sign(sy || 1) * Math.abs(sp.sy) * k;
      if (!fromCenter) {
        shiftX = h.hx !== 0 ? -h.hx * halfW + (f.width * sx * h.hx) / 2 : 0;
        shiftY = h.hy !== 0 ? -h.hy * halfH + (f.height * sy * h.hy) / 2 : 0;
      }
    }
    if (Math.abs(sx) < 1e-3) sx = 1e-3 * Math.sign(sx || 1);
    if (Math.abs(sy) < 1e-3) sy = 1e-3 * Math.sign(sy || 1);
    // The new centre moves by the local shift, rotated back into doc space.
    const sh = Mat.apply(rot, { x: shiftX, y: shiftY });
    session.params.sx = sx;
    session.params.sy = sy;
    session.params.tx = sp.tx + sh.x;
    session.params.ty = sp.ty + sh.y;
  }

  function onUp(e: PointerEvent): void {
    if (!ds) return;
    ds = null;
    drag = null;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  function onDblClick(e: MouseEvent): void {
    const hit = hitTest({ x: e.clientX, y: e.clientY });
    if (hit?.mode === "move") void session.commit();
  }

  let cursor = $state("default");
  function cursorFor(hit: ReturnType<typeof hitTest>, p: Point): string {
    if (!hit) return "default";
    if (hit.mode === "move") return "move";
    if (hit.mode === "rotate") return "alias";
    const v = view!;
    const ang = Math.atan2(p.y - v.cy, p.x - v.cx);
    const oct = Math.round((ang / Math.PI) * 4);
    const cursors = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
    return cursors[((oct % 4) + 4) % 4]!;
  }

  // ----------------------------------------------------------------- keyboard + fields

  function onKey(e: KeyboardEvent): void {
    if (!session.active) return;
    // A dialog / the palette on top owns Enter and Esc (this listener runs in the capture
    // phase, before the shell's dispatcher and the dialogs' own handlers).
    if (ui.modalOpen || ui.paletteOpen || ui.textEdit) return;
    if (e.target instanceof HTMLElement && e.target.closest('[role="dialog"]') && !e.target.closest(".pf-transform-overlay")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void session.commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      session.cancel();
    } else if (e.key.startsWith("Arrow") && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") session.params.tx -= step;
      if (e.key === "ArrowRight") session.params.tx += step;
      if (e.key === "ArrowUp") session.params.ty -= step;
      if (e.key === "ArrowDown") session.params.ty += step;
    }
  }

  function numField(e: Event, apply: (v: number) => void): void {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) apply(v);
  }

  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
</script>

{#if session.active && view}
  <div class="pf-transform-overlay" style:cursor={drag ? cursorFor({ mode: drag }, { x: 0, y: 0 }) : cursor}>
    <!-- Preview of the floating pixels, placed with a CSS matrix. -->
    <canvas
      class="preview"
      bind:this={previewCanvas}
      style:width="{view.w}px"
      style:height="{view.h}px"
      style:transform={view.css}
      aria-hidden="true"
    ></canvas>

    <!-- Hit surface for handles / box / rotation zones. -->
    <svg
      class="hit"
      role="application"
      aria-label="Free Transform"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
      ondblclick={onDblClick}
    >
      <polygon
        class="box"
        points={view.corners.map((c) => `${c.x},${c.y}`).join(" ")}
      />
      <line class="cross" x1={view.cx - 6} y1={view.cy} x2={view.cx + 6} y2={view.cy} />
      <line class="cross" x1={view.cx} y1={view.cy - 6} x2={view.cx} y2={view.cy + 6} />
      {#each view.handles as h (h.id)}
        <rect class="handle" x={h.x - 4} y={h.y - 4} width="8" height="8" />
      {/each}
    </svg>

    <div class="bar" role="toolbar" aria-label="Transform options">
      <span class="title">Free Transform</span>
      <label><span>X</span><input type="number" step="1" value={Math.round(view.bounds.x)} onchange={(e) => numField(e, (v) => (session.params.tx += v - view!.bounds.x))} /></label>
      <label><span>Y</span><input type="number" step="1" value={Math.round(view.bounds.y)} onchange={(e) => numField(e, (v) => (session.params.ty += v - view!.bounds.y))} /></label>
      <label><span>W</span><input type="number" step="0.1" value={+(session.params.sx * 100).toFixed(1)} onchange={(e) => numField(e, (v) => (session.params.sx = v / 100))} /><em>%</em></label>
      <label><span>H</span><input type="number" step="0.1" value={+(session.params.sy * 100).toFixed(1)} onchange={(e) => numField(e, (v) => (session.params.sy = v / 100))} /><em>%</em></label>
      <label><span>∠</span><input type="number" step="0.1" value={+session.params.angle.toFixed(1)} onchange={(e) => numField(e, (v) => (session.params.angle = v))} /><em>°</em></label>
      <span class="sep"></span>
      <button type="button" title="Flip horizontal" onclick={() => session.flip("h")}>⇋</button>
      <button type="button" title="Flip vertical" onclick={() => session.flip("v")}>⇅</button>
      <span class="sep"></span>
      <button type="button" class="cancel" onclick={() => session.cancel()} disabled={session.busy}>Cancel</button>
      <button type="button" class="commit" onclick={() => void session.commit()} disabled={session.busy}>
        {session.busy ? "Applying…" : "Commit"}
      </button>
    </div>
  </div>
{/if}

<style>
  .pf-transform-overlay {
    position: fixed;
    inset: 0;
    z-index: 800;
    pointer-events: none;
    overflow: hidden;
  }
  .preview {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    image-rendering: auto;
    pointer-events: none;
  }
  .hit {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: auto;
    touch-action: none;
  }
  .box {
    fill: transparent;
    stroke: var(--accent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 3px rgba(124, 92, 255, 0.6));
  }
  .cross {
    stroke: var(--accent-2);
    stroke-width: 1;
  }
  .handle {
    fill: var(--bg-0);
    stroke: var(--accent);
    stroke-width: 1.25;
  }
  .bar {
    position: absolute;
    left: 50%;
    bottom: 36px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    pointer-events: auto;
    background: rgba(18, 21, 28, 0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    font-size: var(--fs-sm);
    color: var(--fg-1);
    white-space: nowrap;
  }
  .title {
    color: var(--fg-0);
    font-weight: 600;
    margin-right: 4px;
  }
  .bar label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .bar label span {
    color: var(--fg-2);
    font-family: var(--font-mono);
  }
  .bar label em {
    font-style: normal;
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
  .bar input {
    width: 64px;
    font: inherit;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--fg-0);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .bar input::-webkit-inner-spin-button {
    -webkit-appearance: none;
  }
  .bar input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--border-strong);
  }
  .bar button {
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    color: var(--fg-0);
    font-size: var(--fs-sm);
  }
  .bar button:hover {
    background: var(--bg-3);
  }
  .bar button.commit {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }
  .bar button:disabled {
    opacity: 0.5;
  }
</style>
