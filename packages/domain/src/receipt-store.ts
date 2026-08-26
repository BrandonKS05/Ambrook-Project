import type { Receipt } from "./receipt.js";

/**
 * Port: the barn's receipt storage.
 *
 * `seq` is a single monotonically increasing change counter across all
 * receipts; every save records the receipt under the sequence number it was
 * changed at, which is what makes incremental pulls ("everything since
 * cursor N") possible.
 */
export interface ReceiptStore {
  findById(id: string): Promise<Receipt | null>;
  save(receipt: Receipt, seq: number): Promise<void>;
  nextSeq(): Promise<number>;
  changedSince(cursor: number): Promise<{ receipts: Receipt[]; cursor: number }>;
  /** Op-id dedup ledger — the idempotency half of exactly-once effects. */
  hasOp(opId: string): Promise<boolean>;
  recordOp(opId: string): Promise<void>;
}
