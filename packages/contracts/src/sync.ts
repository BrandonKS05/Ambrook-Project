import { z } from "zod";

/**
 * Wire schemas validate SHAPE only. Semantic validity — Schedule F line
 * membership, blank-vendor rules — is the domain's job; the barn answers a
 * bad-but-well-shaped op with a per-op `rejected` result instead of failing
 * the whole batch.
 */

/** Sortable HLC encoding: zero-padded wall ms, zero-padded counter, node id. */
const hlcString = z.string().regex(/^\d{15}-\d{6}-.+$/, "expected an HLC string");

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime();

const nonEmpty = z.string().min(1);
const rev = z.number().int().nonnegative();

/** Patch semantics: absent = untouched, null = cleared. */
export const patchSetSchema = z.strictObject({
  vendor: nonEmpty.nullable().optional(),
  totalCents: z.number().int().nonnegative().nullable().optional(),
  purchasedAt: isoDate.nullable().optional(),
  memo: nonEmpty.nullable().optional(),
  category: nonEmpty.nullable().optional(),
});

const opBase = {
  opId: nonEmpty,
  receiptId: nonEmpty,
  deviceId: nonEmpty,
};

export const captureOpSchema = z.object({
  ...opBase,
  kind: z.literal("capture"),
  capturedAt: isoDateTime,
  at: hlcString,
  imageRef: nonEmpty.nullable(),
  initial: patchSetSchema,
});

export const patchOpSchema = z.object({
  ...opBase,
  kind: z.literal("patch"),
  baseRev: rev,
  at: hlcString,
  set: patchSetSchema,
});

export const approveOpSchema = z.object({
  ...opBase,
  kind: z.literal("approve"),
  baseRev: rev,
  at: hlcString,
  category: nonEmpty,
});

export const receiptOpSchema = z.discriminatedUnion("kind", [
  captureOpSchema,
  patchOpSchema,
  approveOpSchema,
]);

const editableValue = z.union([z.string(), z.number(), z.null()]);

export const fieldConflictSchema = z.object({
  field: z.enum(["vendor", "totalCents", "purchasedAt", "memo", "category"]),
  kept: editableValue,
  discarded: editableValue,
  discardedFrom: nonEmpty,
});

export const opResultSchema = z.discriminatedUnion("status", [
  z.object({ opId: nonEmpty, status: z.literal("applied"), rev, conflicts: z.array(fieldConflictSchema) }),
  z.object({ opId: nonEmpty, status: z.literal("duplicate") }),
  z.object({ opId: nonEmpty, status: z.literal("rejected"), reason: z.string() }),
]);

export const syncPushRequestSchema = z.object({
  deviceId: nonEmpty,
  ops: z.array(receiptOpSchema).max(500),
});

export const syncPushResponseSchema = z.object({
  results: z.array(opResultSchema),
});

const stamped = <T extends z.ZodType>(value: T) =>
  z.object({ value, at: hlcString, rev });

export const categorySuggestionDtoSchema = z.object({
  line: nonEmpty,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  source: z.enum(["rules", "claude"]),
  extracted: z.object({
    vendor: nonEmpty.nullable(),
    totalCents: z.number().int().nonnegative().nullable(),
    purchasedAt: isoDate.nullable(),
  }),
});

export const receiptDtoSchema = z.object({
  id: nonEmpty,
  capturedAt: isoDateTime,
  capturedBy: nonEmpty,
  imageRef: nonEmpty.nullable(),
  rev,
  fields: z.object({
    vendor: stamped(z.string().nullable()),
    totalCents: stamped(z.number().int().nullable()),
    purchasedAt: stamped(z.string().nullable()),
    memo: stamped(z.string().nullable()),
    category: stamped(z.string().nullable()),
  }),
  suggestion: categorySuggestionDtoSchema.nullable(),
  approved: stamped(z.boolean()),
  conflictLog: z.array(fieldConflictSchema),
});

export const syncPullRequestSchema = z.object({
  deviceId: nonEmpty,
  cursor: z.number().int().nonnegative(),
});

export const syncPullResponseSchema = z.object({
  receipts: z.array(receiptDtoSchema),
  cursor: z.number().int().nonnegative(),
});

export const imageUploadRequestSchema = z.object({
  base64: z.string().min(1),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

export type PatchSetDto = z.infer<typeof patchSetSchema>;
export type ReceiptOpDto = z.infer<typeof receiptOpSchema>;
export type OpResultDto = z.infer<typeof opResultSchema>;
export type FieldConflictDto = z.infer<typeof fieldConflictSchema>;
export type CategorySuggestionDto = z.infer<typeof categorySuggestionDtoSchema>;
export type ReceiptDto = z.infer<typeof receiptDtoSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
