/**
 * Tool store: active tool, per-tool options (persisted), foreground/background colors,
 * fly-out group memory (last-used tool per group becomes the group's face), Quick Mask
 * and screen mode.
 *
 * v0.2 (tools-v2) additions — contract for the other Wave-6 agents:
 * - `colorSamplers`  Color Sampler tool markers (≤ 4) for the Info panel.
 * - `measure`        Ruler tool readout (length / angle / ΔX / ΔY) for the Info panel.
 * - `historySource`  History Brush source; the History panel sets it (snapshot or state).
 * - `maskTarget`     True while the active layer's **mask** thumbnail is the paint target
 *                    (Layers panel sets it; every paint tool then writes the mask).
 * - `quickMask`      Mirrors `doc.quickMask.active` of the active document; `toggleQuickMask`
 *                    pushes the engine `ToggleQuickMaskCommand` (Q).
 *
 * Tools themselves are plain classes in `$lib/tools`; this store only holds the
 * reactive state they read through `ToolContext`.
 */
import { ToggleQuickMaskCommand, type HistorySource, type RGBA } from "$lib/engine";
import { docStore } from "./doc.svelte";

const LS_KEY = "pixelforge.tools.v1";

export type OptionValue = number | string | boolean;
export type ScreenMode = "standard" | "fullscreen-menu" | "fullscreen";

/** One Color Sampler marker (document pixel + last sampled composite color). */
export interface ColorSampler {
  id: number;
  x: number;
  y: number;
  color: RGBA;
}

/** Ruler tool readout (document pixels; `angle` in degrees, PS convention: 0 = →, CCW positive). */
export interface Measure {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  length: number;
  angle: number;
  dx: number;
  dy: number;
}

interface Persisted {
  activeToolId: string;
  options: Record<string, Record<string, OptionValue>>;
  fg: RGBA;
  bg: RGBA;
  lastInGroup?: Record<string, string>;
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };

function load(): Partial<Persisted> {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function isRgba(v: unknown): v is RGBA {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return ["r", "g", "b", "a"].every((k) => typeof o[k] === "number");
}

export function rgbaToHex(c: RGBA): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function hexToRgba(hex: string, a = 255): RGBA | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
}

/** Resolver injected by the tool registry so the store stays free of tool imports. */
export type GroupResolver = (toolId: string) => string | null;
let resolveGroup: GroupResolver = () => null;
export function setGroupResolver(fn: GroupResolver): void {
  resolveGroup = fn;
}

/** Optional external mask-target source (the Layers panel's own store), bridged by `tools/register.ts`. */
let maskTargetResolver: (() => boolean) | null = null;
export function setMaskTargetResolver(fn: (() => boolean) | null): void {
  maskTargetResolver = fn;
}

class ToolStore {
  activeToolId = $state("move");
  /** Temporarily overriding tool (Space -> hand, Alt with brush -> eyedropper). */
  tempToolId = $state<string | null>(null);
  options = $state<Record<string, Record<string, OptionValue>>>({});
  fg = $state<RGBA>({ ...BLACK });
  bg = $state<RGBA>({ ...WHITE });
  /** Status-bar hint set by the active tool ("Drag to paint. Shift for lines."). */
  hint = $state("");
  /** Last tool chosen in each fly-out group (the group's visible face). */
  lastInGroup = $state<Record<string, string>>({});
  /** F — cycles standard → full screen with menu bar → full screen. */
  screenMode = $state<ScreenMode>("standard");

  // ---- tools-v2 fields ------------------------------------------------------------
  /** Color Sampler markers (Info panel reads them; the tool refreshes `color`). */
  colorSamplers = $state<ColorSampler[]>([]);
  /** Ruler tool readout, or null when no measurement exists. */
  measure = $state<Measure | null>(null);
  /** History Brush source (History panel column). `null` = the first history state. */
  historySource = $state<HistorySource | null>(null);
  /** Paint tools target the active layer's mask instead of its pixels. */
  private _maskTarget = $state(false);
  /** Quick Mask flag used when no document is open (otherwise mirrors the document). */
  private _quickMask = $state(false);

  constructor() {
    const p = load();
    if (typeof p.activeToolId === "string") this.activeToolId = p.activeToolId;
    if (p.options && typeof p.options === "object") this.options = p.options;
    if (isRgba(p.fg)) this.fg = p.fg;
    if (isRgba(p.bg)) this.bg = p.bg;
    if (p.lastInGroup && typeof p.lastInGroup === "object") this.lastInGroup = p.lastInGroup;
  }

  /** The tool id pointer events go to right now. */
  get effectiveToolId(): string {
    return this.tempToolId ?? this.activeToolId;
  }

  /** True while paint tools should write the active layer's mask. */
  get maskTarget(): boolean {
    return this._maskTarget || (maskTargetResolver?.() ?? false);
  }
  set maskTarget(v: boolean) {
    this._maskTarget = v;
  }

  /** Q — Quick Mask mode of the active document (falls back to a plain flag without a doc). */
  get quickMask(): boolean {
    const e = docStore.active;
    if (!e) return this._quickMask;
    void e.version;
    return e.doc.quickMask.active;
  }
  set quickMask(v: boolean) {
    this._quickMask = v;
  }

  persist(): void {
    try {
      const data: Persisted = {
        activeToolId: this.activeToolId,
        options: $state.snapshot(this.options),
        fg: $state.snapshot(this.fg),
        bg: $state.snapshot(this.bg),
        lastInGroup: $state.snapshot(this.lastInGroup),
      };
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  setActive(id: string, group?: string | null): void {
    this.activeToolId = id;
    this.tempToolId = null;
    const g = group ?? resolveGroup(id);
    if (g) this.lastInGroup[g] = id;
    this.persist();
  }

  /** The tool a fly-out group shows on its face: active if inside, else last used, else `fallback`. */
  faceOf(group: string, memberIds: readonly string[], fallback: string): string {
    if (memberIds.includes(this.activeToolId)) return this.activeToolId;
    const last = this.lastInGroup[group];
    return last && memberIds.includes(last) ? last : fallback;
  }

  option<T extends OptionValue>(toolId: string, key: string, fallback: T): T {
    const v = this.options[toolId]?.[key];
    return (v === undefined ? fallback : (v as T)) as T;
  }

  setOption(toolId: string, key: string, value: OptionValue): void {
    const bag = this.options[toolId] ?? (this.options[toolId] = {});
    bag[key] = value;
    this.persist();
  }

  resetOptions(toolId: string): void {
    delete this.options[toolId];
    this.persist();
  }

  setFg(c: RGBA): void {
    this.fg = { ...c, a: 255 };
    this.persist();
  }

  setBg(c: RGBA): void {
    this.bg = { ...c, a: 255 };
    this.persist();
  }

  /** X: swap foreground / background. */
  swap(): void {
    const f = this.fg;
    this.fg = this.bg;
    this.bg = f;
    this.persist();
  }

  /** D: reset to black / white. */
  resetColors(): void {
    this.fg = { ...BLACK };
    this.bg = { ...WHITE };
    this.persist();
  }

  /** Q: enter / leave Quick Mask mode on the active document (undoable). */
  toggleQuickMask(): void {
    const e = docStore.active;
    if (!e) {
      this._quickMask = !this._quickMask;
      return;
    }
    docStore.exec(new ToggleQuickMaskCommand(!e.doc.quickMask.active), { noMerge: true });
    e.compositor?.markDirty("@quickmask");
    this._quickMask = e.doc.quickMask.active;
  }

  cycleScreenMode(): void {
    const order: ScreenMode[] = ["standard", "fullscreen-menu", "fullscreen"];
    this.screenMode = order[(order.indexOf(this.screenMode) + 1) % order.length]!;
  }

  // ---- color samplers / ruler helpers --------------------------------------------

  addColorSampler(x: number, y: number, color: RGBA): ColorSampler | null {
    if (this.colorSamplers.length >= 4) return null;
    const used = new Set(this.colorSamplers.map((s) => s.id));
    let id = 1;
    while (used.has(id)) id++;
    const s: ColorSampler = { id, x, y, color };
    this.colorSamplers = [...this.colorSamplers, s].sort((a, b) => a.id - b.id);
    return s;
  }

  updateColorSampler(id: number, patch: Partial<Omit<ColorSampler, "id">>): void {
    this.colorSamplers = this.colorSamplers.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  removeColorSampler(id: number): void {
    this.colorSamplers = this.colorSamplers.filter((s) => s.id !== id);
  }

  clearColorSamplers(): void {
    this.colorSamplers = [];
  }
}

export const toolStore = new ToolStore();
