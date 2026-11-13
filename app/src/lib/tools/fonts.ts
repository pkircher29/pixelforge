/** Font discovery: browser permission, native system enumeration, then a fallback. */
import { invoke, isTauri } from "@tauri-apps/api/core";

export const FALLBACK_FONTS: readonly string[] = [
  "Arial",
  "Arial Black",
  "Bahnschrift",
  "Calibri",
  "Cambria",
  "Candara",
  "Cascadia Code",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Franklin Gothic Medium",
  "Gabriola",
  "Garamond",
  "Georgia",
  "Gill Sans",
  "Helvetica",
  "Helvetica Neue",
  "Impact",
  "Lucida Console",
  "Lucida Sans",
  "Menlo",
  "Monaco",
  "Palatino Linotype",
  "Segoe Print",
  "Segoe Script",
  "Segoe UI",
  "Segoe UI Black",
  "Segoe UI Light",
  "Segoe UI Semibold",
  "Sitka",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Yu Gothic",
];

interface LocalFontData {
  family: string;
  style: string;
}

let cached: string[] | null = null;
let pending: Promise<string[]> | null = null;

/** Call directly from a user gesture so queryLocalFonts can request permission. */
export function listFonts(refresh = false): Promise<string[]> {
  if (refresh) cached = null;
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  const q = (globalThis as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  pending = (async () => {
    const set = new Set<string>();
    if (typeof q === "function") {
      try {
        const fonts = await q.call(globalThis);
        for (const f of fonts) if (f.family) set.add(f.family);
      } catch {
        /* WebView unsupported or denied: try native system enumeration. */
      }
    }
    if (isTauri()) {
      try {
        for (const family of await invoke<string[]>("fonts_list")) if (family.trim()) set.add(family);
      } catch { /* Keep browser results; transient native failures can be retried. */ }
    }
    if (set.size) cached = [...set].sort((a, b) => a.localeCompare(b));
    return cached ?? [...FALLBACK_FONTS];
  })();
  const request = pending;
  void request.finally(() => { pending = null; });
  return request;
}

/** Synchronous best-effort list (curated until `listFonts` resolved once). */
export function fontsNow(): string[] {
  return cached ?? [...FALLBACK_FONTS];
}

/** Quote a family for CSS `font` shorthand. */
export function quoteFamily(f: string): string {
  return /\s/.test(f) && !/^["']/.test(f) ? `"${f}"` : f;
}
