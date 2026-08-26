import type { Hlc, ReceiptOp, ReceiptProps } from "@saddlebag/domain";

export interface PendingImage {
  ref: string;
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

/**
 * Port: device-local persistence for the sync engine — SQLite on the phone,
 * memory in tests and the field simulator. Everything here must survive an
 * app restart in a dead zone; that is the whole point.
 */
export interface SyncClientStore {
  loadHlc(): Promise<Hlc | null>;
  saveHlc(hlc: Hlc): Promise<void>;

  loadCursor(): Promise<number>;
  saveCursor(cursor: number): Promise<void>;

  getServerReceipt(id: string): Promise<ReceiptProps | null>;
  upsertServerReceipt(props: ReceiptProps): Promise<void>;
  listServerReceipts(): Promise<ReceiptProps[]>;

  enqueueOp(op: ReceiptOp): Promise<void>;
  /** Pending ops in enqueue (FIFO) order — a capture always precedes its edits. */
  pendingOps(): Promise<ReceiptOp[]>;
  removeOps(opIds: readonly string[]): Promise<void>;

  enqueueImage(image: PendingImage): Promise<void>;
  pendingImages(): Promise<PendingImage[]>;
  removeImage(ref: string): Promise<void>;
}
