/**
 * Canvas host: a singleton that the active `CanvasView` registers with so commands,
 * the shortcut dispatcher and the options bar can reach the live tool context
 * (view size, overlay invalidation, tool activation) without prop drilling.
 */
import type { Command, LayerId, Rect, RGBA } from "$lib/engine";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { toolStore, type OptionValue } from "$lib/stores/tool.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { getTool, toolForKey, TOOLS, type Tool, type ToolContext } from "$lib/tools";

export interface CanvasImpl {
  readonly entry: OpenDoc;
  viewSize(): { w: number; h: number };
  invalidateOverlay(): void;
  setCursor(cursor: string): void;
  focus(): void;
}

class CanvasHost {
  viewW = $state(0);
  viewH = $state(0);
  /** "webgl2" | "canvas2d" | "" of the active canvas. */
  compositorKind = $state("");
  cursor = $state("default");
  private impl: CanvasImpl | null = null;

  register(impl: CanvasImpl): void {
    this.impl = impl;
    const s = impl.viewSize();
    this.viewW = s.w;
    this.viewH = s.h;
    this.compositorKind = impl.entry.compositor?.kind ?? "";
    this.applyToolCursor();
  }

  unregister(impl: CanvasImpl): void {
    if (this.impl === impl) {
      this.impl = null;
      this.compositorKind = "";
    }
  }

  setViewSize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  invalidateOverlay(): void {
    this.impl?.invalidateOverlay();
  }

  focusCanvas(): void {
    this.impl?.focus();
  }

  get activeTool(): Tool {
    return getTool(toolStore.effectiveToolId) ?? TOOLS[0]!;
  }

  /** The tool the toolbar shows as selected (ignores temporary Space/hand). */
  get selectedTool(): Tool {
    return getTool(toolStore.activeToolId) ?? TOOLS[0]!;
  }

  /** Live context for the active document, or null when none is open. */
  context(tool: Tool = this.activeTool): ToolContext | null {
    const entry = docStore.active;
    if (!entry) return null;
    return makeContext(entry, tool, this);
  }

  applyToolCursor(): void {
    this.cursor = this.activeTool.cursor;
    this.impl?.setCursor(this.cursor);
  }

  setCursor(c: string): void {
    this.cursor = c;
    this.impl?.setCursor(c);
  }

  activateTool(id: string): void {
    if (!getTool(id)) return;
    const prev = this.selectedTool;
    if (prev.id !== id) {
      const pctx = this.context(prev);
      if (pctx) prev.onDeactivate?.(pctx);
    }
    toolStore.setActive(id);
    const next = this.selectedTool;
    const ctx = this.context(next);
    if (ctx) next.onActivate?.(ctx);
    toolStore.hint = next.hint ?? "";
    ui.textEdit = null;
    this.applyToolCursor();
    this.invalidateOverlay();
  }

  /** Esc: drop the current tool operation. Returns true if something was cancelled. */
  cancelTool(): boolean {
    const tool = this.activeTool;
    const ctx = this.context(tool);
    if (ui.textEdit) {
      ui.textEdit = null;
      return true;
    }
    if (ctx && tool.cancel) {
      tool.cancel(ctx);
      return true;
    }
    return false;
  }

  /** Keyboard → active tool (Space temporary pan, then `tool.onKey`). */
  forwardKey(e: KeyboardEvent, phase: "down" | "up"): boolean {
    if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (phase === "down") {
        if (!e.repeat && toolStore.tempToolId !== "hand" && toolStore.activeToolId !== "hand") {
          toolStore.tempToolId = "hand";
          this.applyToolCursor();
        }
      } else if (toolStore.tempToolId === "hand") {
        toolStore.tempToolId = null;
        this.applyToolCursor();
      }
      return true;
    }
    const tool = this.activeTool;
    const ctx = this.context(tool);
    if (!ctx || !tool.onKey) return false;
    return tool.onKey(e, ctx, phase);
  }

  /** Single-key tool shortcuts and X / D colour keys. */
  handleToolKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (!e.shiftKey && (e.key === "x" || e.key === "X")) {
      toolStore.swap();
      return true;
    }
    if (!e.shiftKey && (e.key === "d" || e.key === "D")) {
      toolStore.resetColors();
      return true;
    }
    const t = toolForKey(e, toolStore.activeToolId, undefined, (g) => ui.toolbarFlyoutChoice[g]);
    if (!t) return false;
    this.activateTool(t.id);
    const group = t.group;
    if (group) ui.setFlyoutChoice(group, t.id);
    return true;
  }
}

export const canvasHost = new CanvasHost();

function optionDefault(tool: Tool, key: string): OptionValue {
  for (const o of tool.options) {
    if (o.key === key && "default" in o) return o.default;
  }
  return "";
}

function makeContext(entry: OpenDoc, tool: Tool, host: CanvasHost): ToolContext {
  return {
    entry,
    get doc() {
      return entry.doc;
    },
    get history() {
      return entry.history;
    },
    get viewport() {
      return entry.viewport;
    },
    get compositor() {
      return entry.compositor;
    },
    get viewW() {
      return host.viewW;
    },
    get viewH() {
      return host.viewH;
    },
    opt<T extends OptionValue>(key: string): T {
      return toolStore.option(tool.id, key, optionDefault(tool, key) as T);
    },
    setOpt(key: string, value: OptionValue) {
      toolStore.setOption(tool.id, key, value);
    },
    fg: () => ({ ...toolStore.fg }),
    bg: () => ({ ...toolStore.bg }),
    setFg: (c: RGBA) => toolStore.setFg(c),
    setBg: (c: RGBA) => toolStore.setBg(c),
    exec(cmd: Command, opts) {
      docStore.exec(cmd, opts);
    },
    touch(dirty?: { layerId: LayerId; rect?: Rect }) {
      docStore.touch(dirty);
    },
    invalidateOverlay: () => host.invalidateOverlay(),
    setCursor: (c: string) => host.setCursor(c),
    hint: (text: string) => {
      toolStore.hint = text;
    },
    notify: (kind, message) => {
      toast[kind](message);
    },
    selectTool: (id: string) => host.activateTool(id),
    setActiveLayer: (id: LayerId) => docStore.setActiveLayer(id),
    beginTextEdit: (docX: number, docY: number) => {
      ui.textEdit = { docX, docY, value: "" };
    },
  };
}
