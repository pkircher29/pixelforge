<script lang="ts">
  /**
   * View ▸ Show ▸ Grid / Layer Edges, drawn over the active document canvas (mounted on
   * `document.body` by `register.ts`, positioned over `canvas[aria-label="Document
   * canvas"]` the same way the Free Transform overlay is). Pointer-transparent.
   */
  import { docStore } from "$lib/stores/doc.svelte";
  import { layerDocRect } from "$lib/engine";
  import { canvasHost } from "../canvas/host.svelte";
  import { viewExtras } from "./view-extras.svelte";

  let el = $state<HTMLCanvasElement | null>(null);
  let rect = $state({ left: 0, top: 0, width: 0, height: 0 });

  const on = $derived(viewExtras.visible("grid") || viewExtras.visible("layerEdges"));

  // Follow the document canvas (layout can move when panels resize).
  $effect(() => {
    if (!on) return;
    let raf = 0;
    const tick = (): void => {
      const c = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Document canvas"]');
      if (c) {
        const r = c.getBoundingClientRect();
        if (r.left !== rect.left || r.top !== rect.top || r.width !== rect.width || r.height !== rect.height) rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  $effect(() => {
    const cv = el;
    const e = docStore.active;
    if (!cv || !on || !e) return;
    void e.version;
    void canvasHost.viewW;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);
    const vp = e.viewport;
    const doc = e.doc;
    if (viewExtras.visible("grid") && vp.rotation === 0) {
      const every = viewExtras.gridEvery;
      const sub = every / Math.max(1, viewExtras.gridSubdivisions);
      const o = vp.docToScreen({ x: 0, y: 0 });
      const end = vp.docToScreen({ x: doc.width, y: doc.height });
      const line = (pos: number, major: boolean, vertical: boolean): void => {
        g.strokeStyle = major ? "rgba(128,128,128,0.85)" : "rgba(128,128,128,0.4)";
        g.setLineDash(major ? [] : [2, 2]);
        g.beginPath();
        if (vertical) {
          g.moveTo(Math.round(pos) + 0.5, o.y);
          g.lineTo(Math.round(pos) + 0.5, end.y);
        } else {
          g.moveTo(o.x, Math.round(pos) + 0.5);
          g.lineTo(end.x, Math.round(pos) + 0.5);
        }
        g.stroke();
      };
      g.lineWidth = 1;
      if (sub * vp.zoom >= 4) {
        for (let x = 0; x <= doc.width; x += sub) line(o.x + x * vp.zoom, x % every === 0, true);
        for (let y = 0; y <= doc.height; y += sub) line(o.y + y * vp.zoom, y % every === 0, false);
      }
      g.setLineDash([]);
    }
    if (viewExtras.visible("layerEdges")) {
      const l = doc.layers.find((x) => x.id === doc.activeLayerId);
      if (l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text")) {
        const r = layerDocRect(doc, l);
        const a = vp.docToScreen({ x: r.x, y: r.y });
        const b = vp.docToScreen({ x: r.x + r.w, y: r.y + r.h });
        g.strokeStyle = "#4d8dff";
        g.lineWidth = 1;
        g.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
      }
    }
  });
</script>

{#if on && docStore.active}
  <canvas bind:this={el} class="pf-view-extras" style:left="{rect.left}px" style:top="{rect.top}px" style:width="{rect.width}px" style:height="{rect.height}px" aria-hidden="true"></canvas>
{/if}

<style>
  .pf-view-extras {
    position: fixed;
    z-index: 5;
    pointer-events: none;
  }
</style>
