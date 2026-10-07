/** Font family enumeration: `window.queryLocalFonts` when available, else a curated list. */

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

/** Family names, sorted; local fonts merged in when the API grants access. */
export function listFonts(): Promise<string[]> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  const q = (globalThis as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  pending = (async () => {
    const set = new Set<string>(FALLBACK_FONTS);
    if (typeof q === "function") {
      try {
        const fonts = await q.call(globalThis);
        for (const f of fonts) if (f.family) set.add(f.family);
      } catch {
        /* permission denied / unsupported: keep the curated list */
      }
    }
    cached = [...set].sort((a, b) => a.localeCompare(b));
    return cached;
  })();
  return pending;
}

/** Synchronous best-effort list (curated until `listFonts` resolved once). */
export function fontsNow(): string[] {
  return cached ?? [...FALLBACK_FONTS];
}

/** Quote a family for CSS `font` shorthand. */
export function quoteFamily(f: string): string {
  return /\s/.test(f) && !/^["']/.test(f) ? `"${f}"` : f;
}
