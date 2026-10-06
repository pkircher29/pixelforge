/**
 * Merge Down / Merge Visible / Flatten.
 */

import { flatten, mergeDown, mergeVisible } from "../document";
import type { Document, LayerId } from "../types";
import { StructuralCommand } from "./structural";

export class MergeDownCommand extends StructuralCommand {
  readonly label = "Merge Down";
  private readonly layerId: LayerId;

  constructor(layerId: LayerId) {
    super();
    this.layerId = layerId;
  }

  protected apply(doc: Document): void {
    mergeDown(doc, this.layerId);
  }
}

export class MergeVisibleCommand extends StructuralCommand {
  readonly label = "Merge Visible";

  protected apply(doc: Document): void {
    mergeVisible(doc);
  }
}

export class FlattenCommand extends StructuralCommand {
  readonly label = "Flatten Image";

  protected apply(doc: Document): void {
    flatten(doc);
  }
}
