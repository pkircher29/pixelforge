/**
 * Tiny fuzzy matcher for the command palette. Subsequence match with bonuses for
 * word starts and consecutive runs; returns `null` when `query` is not a subsequence.
 */

export interface FuzzyResult {
  score: number;
  /** Indices of matched characters in `text`. */
  indices: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    if (ti === prev + 1 && t[ti] === ch) {
      // Continue a consecutive run first.
      found = ti;
    } else {
      // Otherwise prefer a word-start occurrence when one exists nearby.
      for (let k = ti; k < t.length; k++) {
        if (t[k] !== ch) continue;
        if (found < 0) found = k;
        if (k === 0 || /[\s/._-]/.test(t[k - 1]!)) {
          found = k;
          break;
        }
        if (k - found > 8) break;
      }
    }
    if (found < 0) return null;
    indices.push(found);
    score += 10;
    if (found === prev + 1) score += 8;
    if (found === 0 || /[\s/._-]/.test(t[found - 1]!)) score += 6;
    score -= Math.max(0, found - ti) * 0.5;
    prev = found;
    ti = found + 1;
  }
  // Shorter targets rank higher for the same match quality.
  score -= t.length * 0.05;
  return { score, indices };
}

/** Score a command across label, keywords and menu path; best field wins. */
export function scoreCommand(
  query: string,
  c: { label: string; keywords?: string[]; menu?: string; id: string },
): { score: number; indices: number[] } | null {
  const best = fuzzyMatch(query, c.label);
  let result: FuzzyResult | null = best;
  const alt = [c.menu ?? "", ...(c.keywords ?? []), c.id];
  for (const a of alt) {
    if (!a) continue;
    const m = fuzzyMatch(query, a);
    if (m && (!result || m.score - 4 > result.score)) result = { score: m.score - 4, indices: best ? best.indices : [] };
  }
  return result;
}
