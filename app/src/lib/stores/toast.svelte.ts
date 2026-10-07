/**
 * Toast notifications. `toast.success / error / info(message)` from anywhere; the
 * `Toast.svelte` host renders `toast.items`.
 */

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional second line. */
  detail?: string;
  /** ms; 0 = sticky until dismissed. */
  timeout: number;
}

const DEFAULT_TIMEOUT: Record<ToastKind, number> = { success: 3200, info: 4000, error: 7000 };

class ToastStore {
  items = $state<ToastItem[]>([]);
  private seq = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  push(kind: ToastKind, message: string, opts: { detail?: string; timeout?: number } = {}): number {
    // The same message already showing (e.g. a refusal fired on pointer-down and again
    // on the first move): keep one and restart its timer instead of stacking copies.
    const dup = this.items.find((x) => x.kind === kind && x.message === message && x.detail === opts.detail);
    if (dup) {
      const t = this.timers.get(dup.id);
      if (t) clearTimeout(t);
      if (dup.timeout > 0) this.timers.set(dup.id, setTimeout(() => this.dismiss(dup.id), dup.timeout));
      return dup.id;
    }
    const id = ++this.seq;
    const item: ToastItem = { id, kind, message, timeout: opts.timeout ?? DEFAULT_TIMEOUT[kind] };
    if (opts.detail) item.detail = opts.detail;
    this.items.push(item);
    // Keep the stack short.
    while (this.items.length > 5) this.dismiss(this.items[0]!.id);
    if (item.timeout > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), item.timeout),
      );
    }
    return id;
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    const i = this.items.findIndex((x) => x.id === id);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.items.length = 0;
  }

  success(message: string, detail?: string): number {
    return this.push("success", message, detail ? { detail } : {});
  }

  error(message: string, detail?: string): number {
    return this.push("error", message, detail ? { detail } : {});
  }

  info(message: string, detail?: string): number {
    return this.push("info", message, detail ? { detail } : {});
  }
}

export const toast = new ToastStore();

/** Human message from an IPC `{ code, message }` error or any thrown value. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown };
    if (typeof o.message === "string") return typeof o.code === "string" ? `${o.message} (${o.code})` : o.message;
  }
  if (typeof e === "string") return e;
  return String(e);
}
