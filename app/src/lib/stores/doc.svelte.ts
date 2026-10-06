/**
 * Document store — the single reactive owner of open documents.
 *
 * Engine objects (`Document`, `History`, `Viewport`, compositor) are plain classes /
 * objects and are NOT reactive: `docs` is `$state.raw`, and every `OpenDoc` is a class
 * instance (never deep-proxied), so `docStore.doc`, `docStore.activeLayer` and
 * `entry.doc.layers[i]` are the *same raw objects* that History and commands mutate.
 * Any mutation goes through `exec(cmd)` (or `touch()` for view-only changes), which
 * bumps `version`; UI derives from `version` (and `pixelVersion`) to re-render.
 *
 * Contract is frozen for Wave 3. Owner: ui-shell-tools (may extend with new members,
 * must not rename or remove existing ones).
 */
import {
  History,
  Viewport,
  createDocument,
  type Command,
  type CreateDocumentOptions,
  type Document,
  type ICompositor,
  type Layer,
  type LayerId,
} from "$lib/engine";

export interface OpenDoc {
  /** Same as `doc.id`. */
  id: string;
  doc: Document;
  history: History;
  viewport: Viewport;
  /** Set by the canvas view once mounted; null while no canvas is attached. */
  compositor: ICompositor | null;
  /** Absolute path of the backing `.pfproj` / image file, or null for unsaved. */
  path: string | null;
  /** Bumped on every change to the document — derive from this. */
  version: number;
  /** True when the document has unsaved changes. */
  dirty: boolean;
  /**
   * Bumped only when layer **pixels** or the layer structure changed (commands, `touch`
   * with a dirty rect) — not on view-only touches. Thumbnails derive from this.
   */
  pixelVersion: number;
  /** `doc.name`, read reactively (tracks `version`). */
  readonly name: string;
}

/** Reactive scalars live in `$state` class fields; engine objects stay raw. */
class OpenDocEntry implements OpenDoc {
  readonly id: string;
  readonly doc: Document;
  history: History;
  readonly viewport = new Viewport();
  compositor = $state<ICompositor | null>(null);
  path = $state<string | null>(null);
  version = $state(0);
  dirty = $state(false);
  pixelVersion = $state(0);

  constructor(doc: Document, path: string | null) {
    this.id = doc.id;
    this.doc = doc;
    this.path = path;
    doc.meta.path = path;
    this.history = new History(doc, {
      onApply: (cmd) => {
        const c = this.compositor;
        if (c) cmd.affected?.().forEach((d) => c.markDirty(d.layerId, d.rect));
        this.dirty = true;
        this.version++;
        this.pixelVersion++;
      },
    });
  }

  get name(): string {
    void this.version;
    return this.doc.name;
  }
}

class DocStore {
  docs = $state.raw<OpenDoc[]>([]);
  activeId = $state<string | null>(null);

  /** The active open document, or null. */
  get active(): OpenDoc | null {
    return this.docs.find((d) => d.id === this.activeId) ?? null;
  }

  /** Convenience: active engine `Document` or null. */
  get doc(): Document | null {
    return this.active?.doc ?? null;
  }

  get activeLayer(): Layer | null {
    const d = this.doc;
    if (!d) return null;
    return d.layers.find((l) => l.id === d.activeLayerId) ?? null;
  }

  /** Create and open a new document; returns it and makes it active. */
  create(opts: CreateDocumentOptions & { name?: string }): OpenDoc {
    const doc = createDocument(opts);
    if (opts.name) doc.name = opts.name;
    return this.open(doc, null);
  }

  /** Open an existing engine document (from file open / paste / AI) and make it active. */
  open(doc: Document, path: string | null): OpenDoc {
    const entry = new OpenDocEntry(doc, path);
    this.docs = [...this.docs, entry];
    this.activeId = entry.id;
    return entry;
  }

  /** Open document by id, or null. */
  get(id: string): OpenDoc | null {
    return this.docs.find((d) => d.id === id) ?? null;
  }

  close(id: string): void {
    const i = this.docs.findIndex((d) => d.id === id);
    if (i < 0) return;
    const e = this.docs[i]!;
    if (e.compositor) {
      e.compositor.dispose();
      e.compositor = null;
    }
    this.docs = this.docs.filter((d) => d.id !== id);
    if (this.activeId === id) this.activeId = this.docs[Math.min(i, this.docs.length - 1)]?.id ?? null;
  }

  activate(id: string): void {
    if (this.docs.some((d) => d.id === id)) this.activeId = id;
  }

  /** Next / previous tab (Ctrl+Tab, Ctrl+Shift+Tab). */
  cycle(delta: 1 | -1): void {
    if (this.docs.length < 2) return;
    const i = this.docs.findIndex((d) => d.id === this.activeId);
    const n = (i + delta + this.docs.length) % this.docs.length;
    this.activeId = this.docs[n]!.id;
  }

  /** Execute an undoable command on the active document. */
  exec(cmd: Command, opts?: { alreadyApplied?: boolean; noMerge?: boolean }): void {
    const a = this.active;
    if (!a) return;
    a.history.push(cmd, opts);
  }

  undo(): void {
    const a = this.active;
    if (a?.history.canUndo) a.history.undo();
  }

  redo(): void {
    const a = this.active;
    if (a?.history.canRedo) a.history.redo();
  }

  /**
   * Signal a non-undoable change (viewport pan/zoom, selection preview, in-progress brush
   * stroke before its PaintCommand is pushed). Optionally marks a layer rect dirty.
   */
  touch(dirty?: { layerId: LayerId; rect?: { x: number; y: number; w: number; h: number } }): void {
    const a = this.active;
    if (!a) return;
    if (dirty) {
      a.compositor?.markDirty(dirty.layerId, dirty.rect);
      a.pixelVersion++;
    }
    a.version++;
  }

  /** Signal that the selection changed without a command (tool previews). */
  touchSelection(): void {
    const a = this.active;
    if (!a) return;
    a.version++;
  }

  setActiveLayer(id: LayerId): void {
    const a = this.active;
    if (!a) return;
    a.doc.activeLayerId = id;
    a.version++;
  }

  markSaved(path: string): void {
    const a = this.active;
    if (!a) return;
    a.path = path;
    a.doc.meta.path = path;
    a.doc.dirty = false;
    a.dirty = false;
    a.version++;
  }
}

export const docStore = new DocStore();
