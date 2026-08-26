import type { ReceiptOp } from "./ops.js";
import { Receipt } from "./receipt.js";

/**
 * A device's view of one receipt: the last state the barn confirmed, with
 * every not-yet-synced local op replayed on top. Pending edits win locally
 * (optimistic UI); the barn's merge decides for everyone once they sync.
 */
export function projectLocal(server: Receipt | null, pending: readonly ReceiptOp[]): Receipt | null {
  let current = server;
  for (const op of pending) {
    switch (op.kind) {
      case "capture":
        if (current === null) {
          current = Receipt.capture({
            id: op.receiptId,
            deviceId: op.deviceId,
            capturedAt: op.capturedAt,
            at: op.at,
            imageRef: op.imageRef,
            initial: op.initial,
          });
        }
        break;
      case "patch":
        if (current !== null) {
          current = current.applyPatch(
            { set: op.set, at: op.at, baseRev: current.rev },
            current.rev,
          ).receipt;
        }
        break;
      case "approve":
        if (current !== null) {
          current = current.applyApprove(
            { category: op.category, at: op.at, baseRev: current.rev },
            current.rev,
          ).receipt;
        }
        break;
    }
  }
  return current;
}
