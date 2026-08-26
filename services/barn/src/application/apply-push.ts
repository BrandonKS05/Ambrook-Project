import {
  InvariantViolationError,
  Receipt,
  type OpResult,
  type ReceiptOp,
  type ReceiptStore,
} from "@saddlebag/domain";

/**
 * Applies a pushed op batch. Exactly-once effects under at-least-once
 * delivery come from two layers: the op-id ledger answers retries with
 * `duplicate`, and the merge itself is a fixpoint — replaying an op that
 * slipped past the ledger (crash between apply and record) changes nothing,
 * because its stamps no longer beat the state they already produced.
 */
export class ApplyPush {
  constructor(private readonly receipts: ReceiptStore) {}

  async execute(ops: readonly ReceiptOp[]): Promise<{ results: OpResult[]; touched: string[] }> {
    const results: OpResult[] = [];
    const touched = new Set<string>();
    for (const op of ops) {
      if (await this.receipts.hasOp(op.opId)) {
        results.push({ opId: op.opId, status: "duplicate" });
        continue;
      }
      let result: OpResult;
      try {
        result = await this.applyOne(op);
      } catch (error) {
        if (!(error instanceof InvariantViolationError)) throw error;
        result = { opId: op.opId, status: "rejected", reason: error.message };
      }
      await this.receipts.recordOp(op.opId);
      results.push(result);
      if (result.status === "applied") touched.add(op.receiptId);
    }
    return { results, touched: [...touched] };
  }

  private async applyOne(op: ReceiptOp): Promise<OpResult> {
    if (op.kind === "capture") {
      if ((await this.receipts.findById(op.receiptId)) !== null) {
        return { opId: op.opId, status: "duplicate" };
      }
      const receipt = Receipt.capture({
        id: op.receiptId,
        deviceId: op.deviceId,
        capturedAt: op.capturedAt,
        at: op.at,
        imageRef: op.imageRef,
        initial: op.initial,
      });
      await this.receipts.save(receipt, await this.receipts.nextSeq());
      return { opId: op.opId, status: "applied", rev: receipt.rev, conflicts: [] };
    }

    const receipt = await this.receipts.findById(op.receiptId);
    if (receipt === null) {
      return { opId: op.opId, status: "rejected", reason: `unknown receipt "${op.receiptId}"` };
    }
    const applied =
      op.kind === "patch"
        ? receipt.applyPatch({ set: op.set, at: op.at, baseRev: op.baseRev }, receipt.rev + 1)
        : receipt.applyApprove({ category: op.category, at: op.at, baseRev: op.baseRev }, receipt.rev + 1);
    if (applied.receipt !== receipt) {
      await this.receipts.save(applied.receipt, await this.receipts.nextSeq());
    }
    return { opId: op.opId, status: "applied", rev: applied.receipt.rev, conflicts: [...applied.conflicts] };
  }
}
