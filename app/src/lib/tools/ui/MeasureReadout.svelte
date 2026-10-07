<script lang="ts">
  /** Ruler tool readout in the options bar (PS: X Y W H A L1). */
  import { toolStore } from "$lib/stores/tool.svelte";
  const m = $derived(toolStore.measure);
  const f = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
</script>

<span class="ro">
  <span><b>X:</b> {m ? f(m.x0) : "–"}</span>
  <span><b>Y:</b> {m ? f(m.y0) : "–"}</span>
  <span><b>W:</b> {m ? f(Math.abs(m.dx)) : "–"}</span>
  <span><b>H:</b> {m ? f(Math.abs(m.dy)) : "–"}</span>
  <span><b>A:</b> {m ? `${f(m.angle)}°` : "–"}</span>
  <span><b>L1:</b> {m ? f(m.length) : "–"}</span>
</span>

<style>
  .ro {
    display: inline-flex;
    gap: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--ps-text);
  }
  b {
    font-weight: 400;
    color: var(--ps-text-dim);
  }
</style>
