import {
  hlcNow,
  hlcReceive,
  projectLocal,
  Receipt,
  type EditableFields,
  type FieldConflict,
  type Hlc,
  type ReceiptOp,
  type ReceiptProps,
  type ScheduleFLineId,
} from "@saddlebag/domain";

import type { PendingImage, SyncClientStore } from "./client-store.js";
import { opToDto, receiptFromDto } from "./codec.js";
import type { SyncTransport } from "./transport.js";

export interface LocalReceipt {
  receipt: Receipt;
  /** Ops queued in the saddlebag, not yet confirmed by the barn. */
  pendingOps: number;
}

export interface FlushReport {
  uploadedImages: number;
  pushed: number;
  applied: number;
  duplicates: number;
  rejected: { opId: string; reason: string }[];
  /** Concurrent edits the barn's merge had to arbitrate during this flush. */
  conflicts: FieldConflict[];
  pulled: number;
}

const cryptoRandomUUID = (
  globalThis as { crypto?: { randomUUID?: () => string } }
).crypto?.randomUUID?.bind((globalThis as { crypto?: unknown }).crypto);

/**
 * The device-side half of the sync protocol. Every write becomes an op in
 * the local outbox immediately — the network is never on the write path — and
 * `flush()` drives the outbox to the barn whenever connectivity allows.
 * Losing a flush mid-flight is safe: ops are only removed once the barn has
 * answered, and the barn dedupes on opId, so retries cannot double-book.
 */
export class SyncEngine {
  private readonly store: SyncClientStore;
  private readonly transport: SyncTransport;
  private readonly deviceId: string;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(deps: {
    store: SyncClientStore;
    transport: SyncTransport;
    deviceId: string;
    now?: () => number;
    newId?: () => string;
  }) {
    this.store = deps.store;
    this.transport = deps.transport;
    this.deviceId = deps.deviceId;
    this.now = deps.now ?? (() => Date.now());
    const newId = deps.newId ?? cryptoRandomUUID;
    if (newId === undefined) {
      throw new Error("no crypto.randomUUID on this platform — pass deps.newId");
    }
    this.newId = newId;
  }

  async capture(input: {
    initial?: Partial<EditableFields>;
    image?: { base64: string; mediaType: PendingImage["mediaType"] };
  }): Promise<string> {
    const receiptId = this.newId();
    const at = await this.stamp();
    const imageRef = input.image === undefined ? null : `img-${receiptId}`;
    if (input.image !== undefined && imageRef !== null) {
      await this.store.enqueueImage({
        ref: imageRef,
        base64: input.image.base64,
        mediaType: input.image.mediaType,
      });
    }
    await this.store.enqueueOp({
      kind: "capture",
      opId: this.newId(),
      receiptId,
      deviceId: this.deviceId,
      capturedAt: new Date(this.now()).toISOString(),
      at,
      imageRef,
      initial: input.initial ?? {},
    });
    return receiptId;
  }

  async edit(receiptId: string, set: Partial<EditableFields>): Promise<void> {
    const at = await this.stamp();
    await this.store.enqueueOp({
      kind: "patch",
      opId: this.newId(),
      receiptId,
      deviceId: this.deviceId,
      baseRev: await this.baseRev(receiptId),
      at,
      set,
    });
  }

  async approve(receiptId: string, category: ScheduleFLineId): Promise<void> {
    const at = await this.stamp();
    await this.store.enqueueOp({
      kind: "approve",
      opId: this.newId(),
      receiptId,
      deviceId: this.deviceId,
      baseRev: await this.baseRev(receiptId),
      at,
      category,
    });
  }

  /** Everything this device knows: barn state with pending local ops replayed on top. */
  async list(): Promise<LocalReceipt[]> {
    const [serverProps, pending] = await Promise.all([
      this.store.listServerReceipts(),
      this.store.pendingOps(),
    ]);
    const opsByReceipt = new Map<string, ReceiptOp[]>();
    for (const op of pending) {
      const ops = opsByReceipt.get(op.receiptId);
      if (ops === undefined) opsByReceipt.set(op.receiptId, [op]);
      else ops.push(op);
    }

    const out: LocalReceipt[] = [];
    const known = new Set<string>();
    for (const props of serverProps) {
      known.add(props.id);
      const ops = opsByReceipt.get(props.id) ?? [];
      const projected = projectLocal(Receipt.reconstitute(props), ops);
      if (projected !== null) out.push({ receipt: projected, pendingOps: ops.length });
    }
    for (const [receiptId, ops] of opsByReceipt) {
      if (known.has(receiptId)) continue;
      const projected = projectLocal(null, ops);
      if (projected !== null) out.push({ receipt: projected, pendingOps: ops.length });
    }
    return out.sort((a, b) => b.receipt.capturedAt.localeCompare(a.receipt.capturedAt));
  }

  async pendingCount(): Promise<number> {
    return (await this.store.pendingOps()).length;
  }

  /**
   * One full sync: upload queued images, push the outbox, pull barn changes.
   * Throws on network failure with all local state intact — call it again
   * when the signal comes back.
   */
  async flush(): Promise<FlushReport> {
    const report: FlushReport = {
      uploadedImages: 0,
      pushed: 0,
      applied: 0,
      duplicates: 0,
      rejected: [],
      conflicts: [],
      pulled: 0,
    };

    for (const image of await this.store.pendingImages()) {
      await this.transport.uploadImage(image.ref, image.base64, image.mediaType);
      await this.store.removeImage(image.ref);
      report.uploadedImages += 1;
    }

    const ops = await this.store.pendingOps();
    if (ops.length > 0) {
      const response = await this.transport.push({
        deviceId: this.deviceId,
        ops: ops.map(opToDto),
      });
      report.pushed = ops.length;
      const settled: string[] = [];
      for (const result of response.results) {
        settled.push(result.opId);
        if (result.status === "applied") {
          report.applied += 1;
          report.conflicts.push(...result.conflicts);
        } else if (result.status === "duplicate") {
          report.duplicates += 1;
        } else {
          report.rejected.push({ opId: result.opId, reason: result.reason });
        }
      }
      await this.store.removeOps(settled);
    }

    const pullResponse = await this.transport.pull({
      deviceId: this.deviceId,
      cursor: await this.store.loadCursor(),
    });
    let clock = await this.store.loadHlc();
    for (const dto of pullResponse.receipts) {
      const props = receiptFromDto(dto);
      for (const remote of stampsOf(props)) {
        clock = hlcReceive(clock, remote, this.now(), this.deviceId);
      }
      await this.store.upsertServerReceipt(props);
      report.pulled += 1;
    }
    if (clock !== null) await this.store.saveHlc(clock);
    await this.store.saveCursor(pullResponse.cursor);
    return report;
  }

  private async stamp(): Promise<Hlc> {
    const next = hlcNow(await this.store.loadHlc(), this.now(), this.deviceId);
    await this.store.saveHlc(next);
    return next;
  }

  private async baseRev(receiptId: string): Promise<number> {
    return (await this.store.getServerReceipt(receiptId))?.rev ?? 0;
  }
}

function stampsOf(props: ReceiptProps): Hlc[] {
  return [
    props.fields.vendor.at,
    props.fields.totalCents.at,
    props.fields.purchasedAt.at,
    props.fields.memo.at,
    props.fields.category.at,
    props.approved.at,
  ];
}
