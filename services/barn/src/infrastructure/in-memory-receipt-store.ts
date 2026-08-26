import { Receipt, type ReceiptProps, type ReceiptStore } from "@saddlebag/domain";

export class InMemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, { props: ReceiptProps; seq: number }>();
  private readonly ops = new Set<string>();
  private seq = 0;

  async findById(id: string): Promise<Receipt | null> {
    const entry = this.receipts.get(id);
    return entry === undefined ? null : Receipt.reconstitute(entry.props);
  }

  async save(receipt: Receipt, seq: number): Promise<void> {
    this.receipts.set(receipt.id, { props: receipt.toProps(), seq });
  }

  async nextSeq(): Promise<number> {
    this.seq += 1;
    return this.seq;
  }

  async changedSince(cursor: number): Promise<{ receipts: Receipt[]; cursor: number }> {
    const changed = [...this.receipts.values()]
      .filter((entry) => entry.seq > cursor)
      .sort((a, b) => a.seq - b.seq);
    return {
      receipts: changed.map((entry) => Receipt.reconstitute(entry.props)),
      cursor: changed.length === 0 ? cursor : (changed[changed.length - 1]?.seq ?? cursor),
    };
  }

  async hasOp(opId: string): Promise<boolean> {
    return this.ops.has(opId);
  }

  async recordOp(opId: string): Promise<void> {
    this.ops.add(opId);
  }
}
