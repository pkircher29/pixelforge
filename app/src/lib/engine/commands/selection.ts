/**
 * Selection changes are undoable (Photoshop semantics).
 */

import type { Selection } from "../selection";
import type { Command, Document } from "../types";

export class SetSelectionCommand implements Command {
  readonly label: string;
  private readonly next: Selection;
  private prev: Selection | null = null;

  constructor(next: Selection, label = "Select") {
    this.next = next;
    this.label = label;
  }

  do(doc: Document): void {
    if (!this.prev) this.prev = doc.selection;
    doc.selection = this.next;
  }

  undo(doc: Document): void {
    if (this.prev) doc.selection = this.prev;
  }

  byteSize(): number {
    return this.next.byteLength();
  }
}
