/**
 * Pure helpers behind the Layer Style dialog: the effect page list (PS order), default
 * constructors, toggling, global-light propagation, preset application, effect
 * scaling and the "Aa" preview raster. No Svelte.
 */
import {
  BLEND_MODES,
  BLEND_MODE_LABEL,
  DEFAULT_GLOBAL_LIGHT_ALTITUDE,
  DEFAULT_GLOBAL_LIGHT_ANGLE,
  Raster,
  cloneEffects,
  defaultBevelEmboss,
  defaultColorOverlay,
  defaultDropShadow,
  defaultGradientOverlay,
  defaultInnerGlow,
  defaultInnerShadow,
  defaultOuterGlow,
  defaultStroke,
  rasterizeText,
  renderLayerStyle,
  textSpec,
  type BlendMode,
  type LayerEffects,
  type RGBA,
} from "$lib/engine";

/** Effect keys in the dialog's left-column order (PS CC). */
export const STYLE_PAGES = ["bevelEmboss", "stroke", "innerShadow", "innerGlow", "colorOverlay", "gradientOverlay", "outerGlow", "dropShadow"] as const;
export type StyleKey = (typeof STYLE_PAGES)[number];
export type StylePage = "styles" | "blending" | StyleKey;

export const STYLE_LABEL: Record<StyleKey, string> = {
  bevelEmboss: "Bevel & Emboss",
  stroke: "Stroke",
  innerShadow: "Inner Shadow",
  innerGlow: "Inner Glow",
  colorOverlay: "Color Overlay",
  gradientOverlay: "Gradient Overlay",
  outerGlow: "Outer Glow",
  dropShadow: "Drop Shadow",
};

/** Pages PS lists but this release doesn't render (greyed in the column). */
export const DISABLED_PAGES: readonly { after: StyleKey; label: string }[] = [
  { after: "innerGlow", label: "Satin" },
  { after: "gradientOverlay", label: "Pattern Overlay" },
];

export const BLEND_CHOICES = BLEND_MODES.map((m) => ({ value: m, label: BLEND_MODE_LABEL[m] }));

export function defaultEffect(key: StyleKey): NonNullable<LayerEffects[StyleKey]> {
  switch (key) {
    case "bevelEmboss":
      return defaultBevelEmboss();
    case "stroke":
      return defaultStroke();
    case "innerShadow":
      return defaultInnerShadow();
    case "innerGlow":
      return defaultInnerGlow();
    case "colorOverlay":
      return defaultColorOverlay();
    case "gradientOverlay":
      return defaultGradientOverlay();
    case "outerGlow":
      return defaultOuterGlow();
    case "dropShadow":
      return defaultDropShadow();
  }
}

/** Per-session "Make Default" overrides. */
const userDefaults: Partial<Record<StyleKey, NonNullable<LayerEffects[StyleKey]>>> = {};

export function effectDefault(key: StyleKey): NonNullable<LayerEffects[StyleKey]> {
  const u = userDefaults[key];
  return u ? (JSON.parse(JSON.stringify(u)) as NonNullable<LayerEffects[StyleKey]>) : defaultEffect(key);
}

export function makeDefault(key: StyleKey, value: NonNullable<LayerEffects[StyleKey]>): void {
  userDefaults[key] = JSON.parse(JSON.stringify(value)) as NonNullable<LayerEffects[StyleKey]>;
}

export function resetDefault(key: StyleKey): void {
  delete userDefaults[key];
}

/** Empty effects object with PS global light. */
export function emptyEffects(): LayerEffects {
  return { globalLightAngle: DEFAULT_GLOBAL_LIGHT_ANGLE, globalLightAltitude: DEFAULT_GLOBAL_LIGHT_ALTITUDE };
}

/** Turn an effect on (creating it from the default when absent) or off. Returns a new object. */
export function toggleEffect(effects: LayerEffects | null, key: StyleKey, on: boolean): LayerEffects {
  const e = cloneEffects(effects) ?? emptyEffects();
  if (on) {
    const cur = e[key];
    if (cur) cur.enabled = true;
    else (e as Record<string, unknown>)[key] = { ...effectDefault(key), enabled: true };
    syncGlobalLight(e);
  } else if (e[key]) {
    e[key]!.enabled = false;
  }
  return e;
}

/** Set a field on an effect (creating it when needed). Returns a new object. */
export function setEffectField<K extends StyleKey>(effects: LayerEffects | null, key: K, patch: Partial<NonNullable<LayerEffects[K]>>): LayerEffects {
  const e = cloneEffects(effects) ?? emptyEffects();
  const cur = (e[key] ?? effectDefault(key)) as NonNullable<LayerEffects[K]>;
  (e as Record<string, unknown>)[key] = { ...cur, ...patch };
  return e;
}

/** Copy the global light angle / altitude into every effect that uses it. */
export function syncGlobalLight(e: LayerEffects): LayerEffects {
  const angle = e.globalLightAngle ?? DEFAULT_GLOBAL_LIGHT_ANGLE;
  const alt = e.globalLightAltitude ?? DEFAULT_GLOBAL_LIGHT_ALTITUDE;
  for (const k of ["dropShadow", "innerShadow", "bevelEmboss"] as const) {
    const fx = e[k];
    if (fx?.useGlobalLight) {
      fx.angle = angle;
      if (k === "bevelEmboss") (fx as { altitude: number }).altitude = alt;
    }
  }
  return e;
}

/** Set the global light (Layer ▸ Layer Style ▸ Global Light…) and propagate. */
export function setGlobalLight(effects: LayerEffects | null, angle: number, altitude?: number): LayerEffects {
  const e = cloneEffects(effects) ?? emptyEffects();
  e.globalLightAngle = normAngle(angle);
  if (altitude !== undefined) e.globalLightAltitude = Math.max(0, Math.min(90, altitude));
  return syncGlobalLight(e);
}

export function normAngle(a: number): number {
  let v = Math.round(a) % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return v;
}

/**
 * Scale Effects…: multiply every size-like parameter by `pct / 100` (PS scales
 * distance, size, spread-as-px is left alone, stroke size, bevel size / soften).
 */
export function scaleEffects(effects: LayerEffects | null, pct: number): LayerEffects | null {
  if (!effects) return null;
  const e = cloneEffects(effects)!;
  const f = Math.max(1, pct) / 100;
  const sc = (n: number) => Math.max(0, Math.round(n * f * 10) / 10);
  if (e.dropShadow) {
    e.dropShadow.distance = sc(e.dropShadow.distance);
    e.dropShadow.size = sc(e.dropShadow.size);
  }
  if (e.innerShadow) {
    e.innerShadow.distance = sc(e.innerShadow.distance);
    e.innerShadow.size = sc(e.innerShadow.size);
  }
  if (e.outerGlow) e.outerGlow.size = sc(e.outerGlow.size);
  if (e.innerGlow) e.innerGlow.size = sc(e.innerGlow.size);
  if (e.stroke) e.stroke.size = Math.max(1, sc(e.stroke.size));
  if (e.bevelEmboss) {
    e.bevelEmboss.size = sc(e.bevelEmboss.size);
    e.bevelEmboss.soften = sc(e.bevelEmboss.soften);
  }
  return e;
}

/** A Styles-tab preset. */
export interface StylePreset {
  id: string;
  name: string;
  effects: LayerEffects;
}

/** Apply a preset: replaces every effect (PS "Styles" click), keeping the global light. */
export function applyPreset(effects: LayerEffects | null, preset: StylePreset): LayerEffects {
  const base = emptyEffects();
  if (effects?.globalLightAngle !== undefined) base.globalLightAngle = effects.globalLightAngle;
  if (effects?.globalLightAltitude !== undefined) base.globalLightAltitude = effects.globalLightAltitude;
  const p = cloneEffects(preset.effects)!;
  for (const k of STYLE_PAGES) if (p[k]) (base as Record<string, unknown>)[k] = p[k];
  return syncGlobalLight(base);
}

/** Count of enabled effects (dialog title badge / tests). */
export function enabledCount(e: LayerEffects | null): number {
  return e ? STYLE_PAGES.filter((k) => e[k]?.enabled).length : 0;
}

/** The "Aa" source raster used for preview thumbnails (cached). */
let aaCache: Raster | null = null;
export function aaRaster(size = 48): Raster {
  if (aaCache && aaCache.width === size) return aaCache;
  try {
    const spec = textSpec("Aa", Math.round(size * 0.12), Math.round(size * 0.7), { size: Math.round(size * 0.58), bold: true, font: "Segoe UI", color: { r: 90, g: 90, b: 90, a: 255 } });
    aaCache = rasterizeText(spec, size, size);
  } catch {
    // No canvas (tests): a grey square stands in.
    aaCache = new Raster(size, size);
    aaCache.fill({ r: 90, g: 90, b: 90, a: 255 }, { x: Math.round(size * 0.2), y: Math.round(size * 0.2), w: Math.round(size * 0.6), h: Math.round(size * 0.6) });
  }
  return aaCache;
}

/** Render a preview of `effects` on the "Aa" raster, cropped back to `size × size`. */
export function renderStylePreview(effects: LayerEffects | null, size = 48): Raster {
  const src = aaRaster(size);
  if (!effects || enabledCount(effects) === 0) return src;
  const styled = renderLayerStyle(src, effects, 1);
  return styled.raster.crop({ x: styled.extent, y: styled.extent, w: size, h: size });
}

export function rgbaToHex(c: RGBA): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function hexToRgba(hex: string, a = 255): RGBA | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
}

export function blendLabel(m: BlendMode): string {
  return BLEND_MODE_LABEL[m];
}
