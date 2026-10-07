/** AI panel presentation helpers: section open state (per session) and small pure formatters. */
import type { AiJob } from "$lib/ai/jobs.svelte";

/** Collapsible section headers (Advanced uses `aiUi.showAdvanced`). */
export const aiSections = $state({ prompt: true, refs: false, options: true });

/** Mode label tooltip: the resolver's reason plus the emulation note. */
export function modeTooltip(reason: string, emulated: boolean): string {
  return emulated
    ? `${reason}\nThis provider has no pixel mask: Pixelforge crops the composite to the selection, sends an instruct edit and pastes the result back only under the selection.`
    : reason;
}

/** 0..1 when the job reports progress (or is finished), null while it runs without progress. */
export function progressFraction(job: Pick<AiJob, "state" | "pct">): number | null {
  if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") return 1;
  if (job.pct === null || !Number.isFinite(job.pct)) return null;
  return Math.max(0, Math.min(1, job.pct / 100));
}
