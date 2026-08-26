import type { CategorySuggestion } from "./categorizer.js";
import { InvariantViolationError } from "./errors.js";
import { compareHlc, type Hlc } from "./hlc.js";
import { isScheduleFLineId, type ScheduleFLineId } from "./schedule-f.js";

/** A field value plus which write set it. */
export interface Stamped<T> {
  readonly value: T;
  /** Hybrid-logical-clock stamp of the write; `at.node` is the writer. */
  readonly at: Hlc;
  /** Barn revision that recorded the write; 0 while it only exists on-device. */
  readonly rev: number;
}

export interface EditableFields {
  vendor: string | null;
  totalCents: number | null;
  /** Purchase date as an ISO calendar date (yyyy-mm-dd). */
  purchasedAt: string | null;
  memo: string | null;
  category: ScheduleFLineId | null;
}

export const EDITABLE_FIELD_KEYS = [
  "vendor",
  "totalCents",
  "purchasedAt",
  "memo",
  "category",
] as const satisfies readonly (keyof EditableFields)[];

export type StampedFields = { readonly [K in keyof EditableFields]: Stamped<EditableFields[K]> };

type EditableValue = EditableFields[keyof EditableFields];

/**
 * Record of a merge where two writers changed the same field without having
 * seen each other. The merge still picks a winner (latest stamp), but the
 * loser is surfaced here so a human can double-check the outcome.
 */
export interface FieldConflict {
  readonly field: keyof EditableFields;
  readonly kept: EditableValue;
  readonly discarded: EditableValue;
  /** Device whose concurrent write lost the merge. */
  readonly discardedFrom: string;
}

/** Conflicts are kept for review, not forever; the newest entries win the cap. */
const CONFLICT_LOG_CAP = 20;

export interface ReceiptProps {
  readonly id: string;
  /** ISO datetime of the capture moment on the device. */
  readonly capturedAt: string;
  readonly capturedBy: string;
  /** Content hash of the receipt photo, set once at capture. */
  readonly imageRef: string | null;
  /** Barn revision counter; bumped on every recorded change. */
  readonly rev: number;
  readonly fields: StampedFields;
  /** Barn-authored AI proposal; never a booked value until a human approves. */
  readonly suggestion: CategorySuggestion | null;
  readonly approved: Stamped<boolean>;
  readonly conflictLog: readonly FieldConflict[];
}

export type ReceiptStatus = "captured" | "suggested" | "approved";

/**
 * Aggregate root for one captured expense receipt.
 *
 * Invariants:
 * - every editable field carries the stamp of the write that set it; merges
 *   are decided per field by stamp order (last writer wins), never wholesale
 * - a concurrent losing write is never dropped silently — it lands in
 *   {@link ReceiptProps.conflictLog}
 * - the AI suggestion may fill fields that are still empty, but never
 *   overwrites a value a person entered, and never sets `category` itself
 * - approval pins the category the person saw; if a concurrent edit beat it,
 *   the approval does not stick
 */
export class Receipt {
  private constructor(private readonly props: ReceiptProps) {}

  static capture(input: {
    id: string;
    deviceId: string;
    capturedAt: string;
    at: Hlc;
    imageRef: string | null;
    initial?: Partial<EditableFields>;
  }): Receipt {
    assertNonEmpty("receipt id", input.id);
    assertNonEmpty("device id", input.deviceId);
    const initial = input.initial ?? {};
    validateFieldValues(initial);
    const stamp = <T>(value: T): Stamped<T> => ({ value, at: input.at, rev: 0 });
    return new Receipt({
      id: input.id,
      capturedAt: input.capturedAt,
      capturedBy: input.deviceId,
      imageRef: input.imageRef,
      rev: 0,
      fields: {
        vendor: stamp(initial.vendor ?? null),
        totalCents: stamp(initial.totalCents ?? null),
        purchasedAt: stamp(initial.purchasedAt ?? null),
        memo: stamp(initial.memo ?? null),
        category: stamp(initial.category ?? null),
      },
      suggestion: null,
      approved: stamp(false),
      conflictLog: [],
    });
  }

  /** Rebuilds a receipt from persisted state. Intended for store adapters. */
  static reconstitute(props: ReceiptProps): Receipt {
    assertNonEmpty("receipt id", props.id);
    if (props.rev < 0 || !Number.isInteger(props.rev)) {
      throw new InvariantViolationError(`receipt "${props.id}" has invalid rev ${props.rev}`);
    }
    return new Receipt(props);
  }

  get id(): string {
    return this.props.id;
  }

  get capturedAt(): string {
    return this.props.capturedAt;
  }

  get capturedBy(): string {
    return this.props.capturedBy;
  }

  get imageRef(): string | null {
    return this.props.imageRef;
  }

  get rev(): number {
    return this.props.rev;
  }

  get suggestion(): CategorySuggestion | null {
    return this.props.suggestion;
  }

  get conflictLog(): readonly FieldConflict[] {
    return this.props.conflictLog;
  }

  get stampedFields(): StampedFields {
    return this.props.fields;
  }

  /** Current field values, without their stamps. */
  get fields(): EditableFields {
    return {
      vendor: this.props.fields.vendor.value,
      totalCents: this.props.fields.totalCents.value,
      purchasedAt: this.props.fields.purchasedAt.value,
      memo: this.props.fields.memo.value,
      category: this.props.fields.category.value,
    };
  }

  get isApproved(): boolean {
    return this.props.approved.value;
  }

  get status(): ReceiptStatus {
    if (this.props.approved.value) return "approved";
    if (this.props.suggestion !== null) return "suggested";
    return "captured";
  }

  /**
   * Merges an edit into the receipt, field by field.
   *
   * `baseRev` is the last barn revision the editor had seen. A field the barn
   * has recorded since then was changed concurrently: the later stamp still
   * wins, but the disagreement is logged. `nextRev` is the barn revision this
   * application will be recorded under (pass the current rev when projecting
   * locally — provisional writes stay at their old rev until the barn confirms).
   */
  applyPatch(
    patch: { set: Partial<EditableFields>; at: Hlc; baseRev: number },
    nextRev: number,
  ): { receipt: Receipt; conflicts: FieldConflict[] } {
    validateFieldValues(patch.set);
    const conflicts: FieldConflict[] = [];
    let fields = this.props.fields;
    let changed = false;

    for (const key of EDITABLE_FIELD_KEYS) {
      const incoming = patch.set[key];
      if (incoming === undefined) continue;

      const current = fields[key];
      const incomingWins = compareHlc(patch.at, current.at) > 0;
      const concurrent = current.rev > patch.baseRev;

      if (concurrent && current.value !== incoming) {
        conflicts.push(
          incomingWins
            ? { field: key, kept: incoming, discarded: current.value, discardedFrom: current.at.node }
            : { field: key, kept: current.value, discarded: incoming, discardedFrom: patch.at.node },
        );
      }
      if (incomingWins && current.value !== incoming) {
        fields = withStamp(fields, key, { value: incoming, at: patch.at, rev: nextRev });
        changed = true;
      }
    }

    if (!changed && conflicts.length === 0) {
      return { receipt: this, conflicts: [] };
    }
    return {
      receipt: new Receipt({
        ...this.props,
        fields,
        rev: nextRev,
        conflictLog: appendConflicts(this.props.conflictLog, conflicts),
      }),
      conflicts,
    };
  }

  /**
   * Records a human approving a category. The category write merges like any
   * edit; the `approved` flag is only set if the approved category is the one
   * that survived the merge.
   */
  applyApprove(
    input: { category: ScheduleFLineId; at: Hlc; baseRev: number },
    nextRev: number,
  ): { receipt: Receipt; conflicts: FieldConflict[] } {
    const patched = this.applyPatch(
      { set: { category: input.category }, at: input.at, baseRev: input.baseRev },
      nextRev,
    );
    const afterPatch = patched.receipt.props;
    const approvalSurvived = afterPatch.fields.category.value === input.category;
    const approvalIsNewer = compareHlc(input.at, afterPatch.approved.at) > 0;
    if (!approvalSurvived || !approvalIsNewer) {
      return patched;
    }
    return {
      receipt: new Receipt({
        ...afterPatch,
        approved: { value: true, at: input.at, rev: nextRev },
        rev: nextRev,
      }),
      conflicts: patched.conflicts,
    };
  }

  /**
   * Barn-side: attaches the AI's proposal. Extracted facts fill fields that
   * are still empty; a value a person already entered is never overwritten.
   */
  withSuggestion(suggestion: CategorySuggestion, at: Hlc, nextRev: number): Receipt {
    if (suggestion.confidence < 0 || suggestion.confidence > 1) {
      throw new InvariantViolationError(
        `suggestion confidence must be within [0, 1], got ${suggestion.confidence}`,
      );
    }
    let fields = this.props.fields;
    const fill = (key: "vendor" | "totalCents" | "purchasedAt", value: string | number | null) => {
      if (value !== null && fields[key].value === null) {
        fields = withStamp(fields, key, { value, at, rev: nextRev });
      }
    };
    fill("vendor", suggestion.extracted.vendor);
    fill("totalCents", suggestion.extracted.totalCents);
    fill("purchasedAt", suggestion.extracted.purchasedAt);
    return new Receipt({ ...this.props, fields, suggestion, rev: nextRev });
  }

  toProps(): ReceiptProps {
    return { ...this.props, conflictLog: [...this.props.conflictLog] };
  }
}

function withStamp(
  fields: StampedFields,
  key: keyof EditableFields,
  stamped: Stamped<EditableValue>,
): StampedFields {
  return { ...fields, [key]: stamped } as StampedFields;
}

function appendConflicts(
  log: readonly FieldConflict[],
  incoming: readonly FieldConflict[],
): readonly FieldConflict[] {
  if (incoming.length === 0) return log;
  return [...log, ...incoming].slice(-CONFLICT_LOG_CAP);
}

function assertNonEmpty(what: string, value: string): void {
  if (value.trim().length === 0) {
    throw new InvariantViolationError(`${what} must be non-empty`);
  }
}

function validateFieldValues(partial: Partial<EditableFields>): void {
  const { vendor, totalCents, purchasedAt, memo, category } = partial;
  if (vendor !== undefined && vendor !== null && vendor.trim().length === 0) {
    throw new InvariantViolationError('vendor cannot be blank — clear it with null, not ""');
  }
  if (memo !== undefined && memo !== null && memo.trim().length === 0) {
    throw new InvariantViolationError('memo cannot be blank — clear it with null, not ""');
  }
  if (totalCents !== undefined && totalCents !== null) {
    if (!Number.isInteger(totalCents) || totalCents < 0) {
      throw new InvariantViolationError(`totalCents must be a non-negative integer, got ${totalCents}`);
    }
  }
  if (purchasedAt !== undefined && purchasedAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) {
    throw new InvariantViolationError(`purchasedAt must be yyyy-mm-dd, got "${purchasedAt}"`);
  }
  if (category !== undefined && category !== null && !isScheduleFLineId(category)) {
    throw new InvariantViolationError(`unknown Schedule F line: "${String(category)}"`);
  }
}
