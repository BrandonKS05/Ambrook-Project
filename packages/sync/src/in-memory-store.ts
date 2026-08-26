import type { Hlc, ReceiptOp, ReceiptProps } from "@saddlebag/domain";

import type { PendingImage, SyncClientStore } from "./client-store.js";

export class InMemoryClientStore implements SyncClientStore {
  private hlc: Hlc | null = null;
  private cursor = 0;
  private readonly server = new Map<string, ReceiptProps>();
  private ops: ReceiptOp[] = [];
  private images: PendingImage[] = [];

  async loadHlc(): Promise<Hlc | null> {
    return this.hlc;
  }

  async saveHlc(hlc: Hlc): Promise<void> {
    this.hlc = hlc;
  }

  async loadCursor(): Promise<number> {
    return this.cursor;
  }

  async saveCursor(cursor: number): Promise<void> {
    this.cursor = cursor;
  }

  async getServerReceipt(id: string): Promise<ReceiptProps | null> {
    return this.server.get(id) ?? null;
  }

  async upsertServerReceipt(props: ReceiptProps): Promise<void> {
    this.server.set(props.id, props);
  }

  async listServerReceipts(): Promise<ReceiptProps[]> {
    return [...this.server.values()];
  }

  async enqueueOp(op: ReceiptOp): Promise<void> {
    this.ops.push(op);
  }

  async pendingOps(): Promise<ReceiptOp[]> {
    return [...this.ops];
  }

  async removeOps(opIds: readonly string[]): Promise<void> {
    const done = new Set(opIds);
    this.ops = this.ops.filter((op) => !done.has(op.opId));
  }

  async enqueueImage(image: PendingImage): Promise<void> {
    this.images.push(image);
  }

  async pendingImages(): Promise<PendingImage[]> {
    return [...this.images];
  }

  async removeImage(ref: string): Promise<void> {
    this.images = this.images.filter((image) => image.ref !== ref);
  }
}
