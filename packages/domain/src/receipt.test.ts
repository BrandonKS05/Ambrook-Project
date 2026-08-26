import { describe, expect, it } from "vitest";

import type { CategorySuggestion } from "./categorizer.js";
import type { Hlc } from "./hlc.js";
import type { CaptureOp, PatchOp } from "./ops.js";
import { projectLocal } from "./project-local.js";
import { Receipt } from "./receipt.js";

const at = (wall: number, node = "field-a"): Hlc => ({ wall, counter: 0, node });

function captured(): Receipt {
  return Receipt.capture({
    id: "r-1",
    deviceId: "field-a",
    capturedAt: "2026-08-26T15:00:00.000Z",
    at: at(1000),
    imageRef: "sha256-abc",
    initial: { vendor: "Tractor Supply Co", totalCents: 18437 },
  });
}

function suggestion(overrides: Partial<CategorySuggestion> = {}): CategorySuggestion {
  return {
    line: "F28",
    confidence: 0.92,
    rationale: "Fence staples and posts are operating supplies.",
    source: "rules",
    extracted: { vendor: "TRACTOR SUPPLY CO #1234", totalCents: 18437, purchasedAt: "2026-08-26" },
    ...overrides,
  };
}

describe("Receipt.capture", () => {
  it("stamps every field at the capture moment, rev 0", () => {
    const receipt = captured();
    expect(receipt.rev).toBe(0);
    expect(receipt.status).toBe("captured");
    expect(receipt.fields).toEqual({
      vendor: "Tractor Supply Co",
      totalCents: 18437,
      purchasedAt: null,
      memo: null,
      category: null,
    });
    expect(receipt.stampedFields.vendor.at).toEqual(at(1000));
  });

  it("rejects invalid field values", () => {
    const base = {
      id: "r-1",
      deviceId: "field-a",
      capturedAt: "2026-08-26T15:00:00.000Z",
      at: at(1000),
      imageRef: null,
    };
    expect(() => Receipt.capture({ ...base, initial: { vendor: "  " } })).toThrow(/vendor/);
    expect(() => Receipt.capture({ ...base, initial: { totalCents: 12.5 } })).toThrow(/totalCents/);
    expect(() => Receipt.capture({ ...base, initial: { totalCents: -1 } })).toThrow(/totalCents/);
    expect(() => Receipt.capture({ ...base, initial: { purchasedAt: "08/26/2026" } })).toThrow(
      /purchasedAt/,
    );
  });
});

describe("Receipt.applyPatch", () => {
  it("applies an up-to-date edit without conflicts", () => {
    const { receipt, conflicts } = captured().applyPatch(
      { set: { memo: "fence fix, north pasture" }, at: at(2000), baseRev: 0 },
      1,
    );
    expect(conflicts).toEqual([]);
    expect(receipt.rev).toBe(1);
    expect(receipt.fields.memo).toBe("fence fix, north pasture");
    expect(receipt.stampedFields.memo.rev).toBe(1);
  });

  it("is a no-op when the incoming stamp is older and nothing was concurrent", () => {
    const base = captured();
    const { receipt, conflicts } = base.applyPatch(
      { set: { vendor: "stale write" }, at: at(500, "field-b"), baseRev: 0 },
      1,
    );
    expect(conflicts).toEqual([]);
    expect(receipt).toBe(base);
  });

  it("logs a conflict when a concurrent edit wins, keeping the later stamp", () => {
    const barnEdit = captured().applyPatch(
      { set: { category: "F16" }, at: at(3000, "barn"), baseRev: 0 },
      1,
    ).receipt;

    const { receipt, conflicts } = barnEdit.applyPatch(
      { set: { category: "F28" }, at: at(4000, "field-a"), baseRev: 0 },
      2,
    );
    expect(receipt.fields.category).toBe("F28");
    expect(conflicts).toEqual([
      { field: "category", kept: "F28", discarded: "F16", discardedFrom: "barn" },
    ]);
    expect(receipt.conflictLog).toHaveLength(1);
  });

  it("logs a conflict when a concurrent edit loses, keeping the current value", () => {
    const barnEdit = captured().applyPatch(
      { set: { category: "F16" }, at: at(5000, "barn"), baseRev: 0 },
      1,
    ).receipt;

    const { receipt, conflicts } = barnEdit.applyPatch(
      { set: { category: "F28" }, at: at(4000, "field-a"), baseRev: 0 },
      2,
    );
    expect(receipt.fields.category).toBe("F16");
    expect(conflicts).toEqual([
      { field: "category", kept: "F16", discarded: "F28", discardedFrom: "field-a" },
    ]);
    expect(receipt.rev).toBe(2);
  });

  it("does not call agreeing concurrent writes a conflict", () => {
    const barnEdit = captured().applyPatch(
      { set: { category: "F28" }, at: at(3000, "barn"), baseRev: 0 },
      1,
    ).receipt;

    const { receipt, conflicts } = barnEdit.applyPatch(
      { set: { category: "F28" }, at: at(4000, "field-a"), baseRev: 0 },
      2,
    );
    expect(conflicts).toEqual([]);
    expect(receipt).toBe(barnEdit);
  });

  it("merges field by field: an untouched field never conflicts", () => {
    const barnEdit = captured().applyPatch(
      { set: { memo: "reviewed" }, at: at(3000, "barn"), baseRev: 0 },
      1,
    ).receipt;

    const { receipt, conflicts } = barnEdit.applyPatch(
      { set: { totalCents: 19999 }, at: at(4000, "field-a"), baseRev: 0 },
      2,
    );
    expect(conflicts).toEqual([]);
    expect(receipt.fields.memo).toBe("reviewed");
    expect(receipt.fields.totalCents).toBe(19999);
  });
});

describe("Receipt.withSuggestion", () => {
  it("fills empty fields from the extraction but never overwrites a person", () => {
    const receipt = captured().withSuggestion(suggestion(), at(6000, "barn"), 1);
    expect(receipt.status).toBe("suggested");
    expect(receipt.fields.vendor).toBe("Tractor Supply Co");
    expect(receipt.fields.purchasedAt).toBe("2026-08-26");
    expect(receipt.fields.category).toBeNull();
    expect(receipt.suggestion?.line).toBe("F28");
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() => captured().withSuggestion(suggestion({ confidence: 1.2 }), at(6000, "barn"), 1)).toThrow(
      /confidence/,
    );
  });
});

describe("Receipt.applyApprove", () => {
  it("books the category and marks the receipt approved", () => {
    const { receipt } = captured()
      .withSuggestion(suggestion(), at(6000, "barn"), 1)
      .applyApprove({ category: "F28", at: at(7000, "field-a"), baseRev: 1 }, 2);
    expect(receipt.status).toBe("approved");
    expect(receipt.fields.category).toBe("F28");
  });

  it("does not stick when a concurrent category edit beat the approval", () => {
    const barnEdit = captured().applyPatch(
      { set: { category: "F16" }, at: at(9000, "barn"), baseRev: 0 },
      1,
    ).receipt;

    const { receipt, conflicts } = barnEdit.applyApprove(
      { category: "F28", at: at(8000, "field-a"), baseRev: 0 },
      2,
    );
    expect(receipt.isApproved).toBe(false);
    expect(receipt.fields.category).toBe("F16");
    expect(conflicts).toHaveLength(1);
  });
});

describe("projectLocal", () => {
  const capture: CaptureOp = {
    kind: "capture",
    opId: "op-1",
    receiptId: "r-9",
    deviceId: "field-a",
    capturedAt: "2026-08-26T15:00:00.000Z",
    at: at(1000),
    imageRef: null,
    initial: { vendor: "Cenex Co-op" },
  };
  const patch: PatchOp = {
    kind: "patch",
    opId: "op-2",
    receiptId: "r-9",
    deviceId: "field-a",
    baseRev: 0,
    at: at(2000),
    set: { totalCents: 31255 },
  };

  it("materializes a never-synced receipt from its pending ops", () => {
    const local = projectLocal(null, [capture, patch]);
    expect(local?.fields.vendor).toBe("Cenex Co-op");
    expect(local?.fields.totalCents).toBe(31255);
    expect(local?.rev).toBe(0);
  });

  it("overlays pending edits on the barn state, pending winning locally", () => {
    const server = captured();
    const local = projectLocal(server, [
      { ...patch, receiptId: "r-1", set: { vendor: "TSC (edited offline)" } },
    ]);
    expect(local?.fields.vendor).toBe("TSC (edited offline)");
    expect(server.fields.vendor).toBe("Tractor Supply Co");
  });

  it("ignores a pending capture the barn has already confirmed", () => {
    const server = captured();
    const local = projectLocal(server, [{ ...capture, receiptId: "r-1" }]);
    expect(local).toBe(server);
  });
});
