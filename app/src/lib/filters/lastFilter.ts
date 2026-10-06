/**
 * Remembers the last applied op + params for "Last Filter" (Ctrl+F).
 */

import type { OpDef, ParamValues } from "./types";

let last: { op: OpDef; params: ParamValues } | null = null;

export function recordLastFilter(op: OpDef, params: ParamValues): void {
  last = { op, params: { ...params } };
}

export function getLastFilter(): { op: OpDef; params: ParamValues } | null {
  return last;
}
