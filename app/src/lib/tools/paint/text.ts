/**
 * Compatibility shim (v0.1 single-line text helpers). Editable type now lives in
 * `lib/tools/type.ts` + the engine's `rasterizeText`; `TEXT_FAMILIES` is kept for callers
 * that list fonts synchronously (use `listFonts()` from `lib/tools/fonts` for the full set).
 */
import { FALLBACK_FONTS } from "../fonts";

export const TEXT_FAMILIES: readonly string[] = FALLBACK_FONTS;
export { cssFontFor as cssFont } from "../type";
