/**
 * tools-v2 registrations: Type menu (replaces the shell's disabled stubs; this module is
 * evaluated after `shell-commands.ts`, so same-id registrations win), Stroke / Fill Path
 * commands, brush shortcuts, and the bridge from the Layers panel's mask-target flag to
 * `toolStore.maskTarget`. Imported once from `ui/panels/register.ts`.
 */
import { findPath, type Command } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { setMaskTargetResolver, toolStore } from "$lib/stores/tool.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { registerCommands, runCommand } from "$lib/ui/registry.svelte";
import { openDialog } from "$lib/ui/dialogs/dialogs.svelte";
import { canvasHost } from "$lib/ui/canvas/host.svelte";
import StrokePathDialog from "$lib/ui/dialogs/StrokePathDialog.svelte";
import FillPathDialog from "$lib/ui/dialogs/FillPathDialog.svelte";
import { brushStore } from "./brush-store.svelte";
import { typeSession } from "./type-session.svelte";
import { resolvePaintTarget } from "./paint-target";
import { fillColorFor, fillPathInto, strokePathWithBrush, type FillContents } from "./path-ops";
import { patternById } from "./patterns";
import { boxBlurRegion, dodgeBurn, mapRegion, sharpenRegion, sponge } from "./retouch-math";
import { maskGray, type StrokeBlend } from "./brush-engine";
import type { ToolContext } from "./types";

// Mask targeting: layers-v2's Layers panel owns `layersUi.maskTargeted`.
void import("$lib/ui/panels/Layers.store.svelte")
  .then((m) => {
    const store = (m as { layersUi?: { maskTargeted?: boolean } }).layersUi;
    if (store) setMaskTargetResolver(() => store.maskTargeted === true);
  })
  .catch(() => {});

/** The work path, else the active path, else the first path. */
function currentPath(): ReturnType<typeof findPath> {
  const d = docStore.doc;
  if (!d) return undefined;
  return (d.workPathId ? findPath(d, d.workPathId) : undefined) ?? d.paths[0];
}

function ctxNow(): ToolContext | null {
  return canvasHost.context(canvasHost.selectedTool);
}

function blendForTool(tool: string, ctx: ToolContext, isMask: boolean): StrokeBlend {
  const fg = isMask ? maskGray(ctx.fg()) : ctx.fg();
  switch (tool) {
    case "eraser":
      return isMask ? { mode: "color", color: maskGray(ctx.bg()) } : { mode: "erase" };
    case "smudge":
      return { mode: "smudge", strength: 0.5, fingerColor: null };
    case "blur":
      return { mode: "target", margin: 4, computeTarget: (b, r) => boxBlurRegion(b, r, 3) };
    case "sharpen":
      return { mode: "target", margin: 3, computeTarget: (b, r) => sharpenRegion(b, r, 1.5, 1.2) };
    case "dodge":
    case "burn":
      return { mode: "target", margin: 0, computeTarget: (b, r) => mapRegion(b, r, (c, o) => dodgeBurn(c, tool, "midtones", 0.5, true, o)) };
    case "sponge":
      return { mode: "target", margin: 0, computeTarget: (b, r) => mapRegion(b, r, (c, o) => sponge(c, "desaturate", 1, true, o)) };
    default:
      return { mode: "color", color: fg };
  }
}

/** Stroke Path with a tool (PS Paths ▸ Stroke Path…). Exposed for the Paths panel. */
export async function strokePathWithTool(): Promise<void> {
  const ctx = ctxNow();
  const path = currentPath();
  if (!ctx || !path || path.subpaths.length === 0) {
    toast.info("Draw a path with the Pen tool first.");
    return;
  }
  const r = await openDialog<Record<string, never>, { tool: string; simulatePressure: boolean }>(StrokePathDialog, {});
  if (!r) return;
  const target = resolvePaintTarget(ctx, "stroke");
  if (!target) return;
  let captured;
  try {
    captured = target.capture();
  } catch (err) {
    toast.info((err as Error).message);
    return;
  }
  const settings = { ...brushStore.settings, ...(r.tool === "pencil" ? { hardness: 100 } : {}) };
  const stroke = strokePathWithBrush(target.raster, target.offset, path, settings, blendForTool(r.tool, ctx, target.isMask), {
    opacity: r.tool === "brush" || r.tool === "pencil" ? toolStore.option("brush", "opacity", 100) / 100 : 1,
    selection: ctx.doc.selection,
    simulatePressure: r.simulatePressure,
  });
  if (!stroke) return;
  const cmd: Command | null = target.finish(captured, "Stroke Path", target.raster.bounds());
  if (cmd) docStore.exec(cmd, { alreadyApplied: true, noMerge: true });
  docStore.touch({ layerId: target.dirtyId });
}

/** Fill Path (PS Paths ▸ Fill Path…). */
export async function fillPathWithDialog(): Promise<void> {
  const ctx = ctxNow();
  const path = currentPath();
  if (!ctx || !path || path.subpaths.length === 0) {
    toast.info("Draw a path with the Pen tool first.");
    return;
  }
  const r = await openDialog<Record<string, never>, { contents: string; pattern: string; opacity: number; feather: number; antialias: boolean }>(FillPathDialog, {});
  if (!r) return;
  const target = resolvePaintTarget(ctx, "fill");
  if (!target) return;
  let captured;
  try {
    captured = target.capture();
  } catch (err) {
    toast.info((err as Error).message);
    return;
  }
  const color = fillColorFor(r.contents as FillContents, ctx.fg(), ctx.bg());
  const source = r.contents === "pattern" ? { pattern: patternById(r.pattern).raster } : { color: target.isMask ? maskGray(color) : color };
  fillPathInto(target.raster, target.offset, path, ctx.doc.width, ctx.doc.height, source, { opacity: r.opacity, feather: r.feather, antialias: r.antialias, clip: ctx.doc.selection });
  const cmd = target.finish(captured, "Fill Path", target.raster.bounds());
  if (cmd) docStore.exec(cmd, { alreadyApplied: true, noMerge: true });
  docStore.touch({ layerId: target.dirtyId });
}

function showPanel(id: string): void {
  if (!ui.isPanelVisible(id)) ui.togglePanel(id);
  ui.activateTab(id);
}

const hasTextLayer = (): boolean => docStore.activeLayer?.kind === "text";

registerCommands([
  { id: "type.panels.character", label: "Character Panel", menu: "Type/Panels", order: 100, run: () => showPanel("character") },
  { id: "type.panels.paragraph", label: "Paragraph Panel", menu: "Type/Panels", order: 101, run: () => showPanel("paragraph") },
  {
    id: "type.antialias",
    label: "Anti-Alias Smooth",
    menu: "Type",
    order: 200,
    enabled: () => hasTextLayer() || typeSession.active,
    checked: () => {
      const l = docStore.activeLayer;
      return l?.kind === "text" ? l.text.antialias : true;
    },
    run: async () => {
      const l = docStore.activeLayer;
      if (typeSession.active) typeSession.update({ antialias: !typeSession.spec.antialias });
      else if (l?.kind === "text") {
        const { SetTextLayerCommand } = await import("$lib/engine");
        docStore.exec(new SetTextLayerCommand(l.id, { antialias: !l.text.antialias }, "Anti-Alias"));
      }
    },
  },
  {
    id: "type.orientation.h",
    label: "Horizontal",
    menu: "Type/Orientation",
    order: 300,
    enabled: hasTextLayer,
    checked: () => docStore.activeLayer?.kind === "text" && !(docStore.activeLayer as { text: { vertical: boolean } }).text.vertical,
    run: async () => {
      const l = docStore.activeLayer;
      if (l?.kind !== "text") return;
      const { SetTextLayerCommand } = await import("$lib/engine");
      docStore.exec(new SetTextLayerCommand(l.id, { vertical: false }, "Change Text Orientation"));
    },
  },
  {
    id: "type.orientation.v",
    label: "Vertical",
    menu: "Type/Orientation",
    order: 301,
    enabled: hasTextLayer,
    checked: () => docStore.activeLayer?.kind === "text" && (docStore.activeLayer as { text: { vertical: boolean } }).text.vertical,
    run: async () => {
      const l = docStore.activeLayer;
      if (l?.kind !== "text") return;
      const { SetTextLayerCommand } = await import("$lib/engine");
      docStore.exec(new SetTextLayerCommand(l.id, { vertical: true }, "Change Text Orientation"));
    },
  },
  { id: "type.rasterize", label: "Rasterize Type Layer", menu: "Type", order: 400, enabled: hasTextLayer, run: () => void runCommand("layer.rasterize.type") },
  { id: "type.commit", label: "Commit Type Edit", keywords: ["type", "text"], enabled: () => typeSession.active, run: () => void typeSession.commit() },

  { id: "path.strokeWithTool", label: "Stroke Path with Tool…", keywords: ["path", "pen", "stroke"], enabled: () => !!currentPath(), run: strokePathWithTool },
  { id: "path.fillDialog", label: "Fill Path (Options)…", keywords: ["path", "pen", "fill"], enabled: () => !!currentPath(), run: fillPathWithDialog },

  // F5 toggles Brush Settings (the Window menu entry itself is generated by the shell).
  { id: "window.toggleBrushSettings", label: "Show / Hide Brush Settings", shortcut: "F5", keywords: ["brush", "panel"], run: () => showPanel("brush-settings") },
]);

