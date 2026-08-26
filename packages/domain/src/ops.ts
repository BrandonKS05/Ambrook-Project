import type { Hlc } from "./hlc.js";
import type { EditableFields, FieldConflict } from "./receipt.js";
import type { ScheduleFLineId } from "./schedule-f.js";

interface OpBase {
  /** Client-generated unique id; the barn dedupes on it (at-least-once delivery, exactly-once effect). */
  readonly opId: string;
  readonly receiptId: string;
  readonly deviceId: string;
}

/** A receipt snapped in the field. Carries everything needed to recreate it. */
export interface CaptureOp extends OpBase {
  readonly kind: "capture";
  readonly capturedAt: string;
  readonly at: Hlc;
  readonly imageRef: string | null;
  readonly initial: Partial<EditableFields>;
}

export interface PatchOp extends OpBase {
  readonly kind: "patch";
  /** Last barn revision of this receipt the editor had seen (0 = never synced). */
  readonly baseRev: number;
  readonly at: Hlc;
  readonly set: Partial<EditableFields>;
}

export interface ApproveOp extends OpBase {
  readonly kind: "approve";
  readonly baseRev: number;
  readonly at: Hlc;
  readonly category: ScheduleFLineId;
}

export type ReceiptOp = CaptureOp | PatchOp | ApproveOp;

export type OpResult =
  | { readonly opId: string; readonly status: "applied"; readonly rev: number; readonly conflicts: readonly FieldConflict[] }
  | { readonly opId: string; readonly status: "duplicate" }
  | { readonly opId: string; readonly status: "rejected"; readonly reason: string };
