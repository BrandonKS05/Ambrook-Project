import type {
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from "@saddlebag/contracts";
import { compareHlc, Receipt, type Hlc } from "@saddlebag/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { receiptToDto } from "./codec.js";
import { SyncEngine } from "./engine.js";
import { InMemoryClientStore } from "./in-memory-store.js";
import type { SyncTransport } from "./transport.js";

class FakeTransport implements SyncTransport {
  pushes: SyncPushRequest[] = [];
  pulls: SyncPullRequest[] = [];
  uploads: string[] = [];
  onPush: (request: SyncPushRequest) => SyncPushResponse = (request) => ({
    results: request.ops.map((op) => ({ opId: op.opId, status: "applied", rev: 1, conflicts: [] })),
  });
  onPull: () => SyncPullResponse = () => ({ receipts: [], cursor: 0 });
  failNext = false;

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    this.failWhenAsked();
    this.pushes.push(request);
    return this.onPush(request);
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    this.failWhenAsked();
    this.pulls.push(request);
    return this.onPull();
  }

  async uploadImage(ref: string): Promise<void> {
    this.failWhenAsked();
    this.uploads.push(ref);
  }

  private failWhenAsked(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("no signal out here");
    }
  }
}

function makeEngine(transport: FakeTransport, nowMs = () => 1_000) {
  const store = new InMemoryClientStore();
  let nextId = 0;
  const engine = new SyncEngine({
    store,
    transport,
    deviceId: "field-a",
    now: nowMs,
    newId: () => `id-${(nextId += 1)}`,
  });
  return { engine, store };
}

describe("SyncEngine offline", () => {
  let transport: FakeTransport;

  beforeEach(() => {
    transport = new FakeTransport();
  });

  it("captures and edits without touching the network", async () => {
    const { engine } = makeEngine(transport);
    const id = await engine.capture({ initial: { vendor: "Cenex Co-op" } });
    await engine.edit(id, { totalCents: 31255 });

    const listed = await engine.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.receipt.fields).toMatchObject({ vendor: "Cenex Co-op", totalCents: 31255 });
    expect(listed[0]?.pendingOps).toBe(2);
    expect(transport.pushes).toHaveLength(0);
  });

  it("keeps the outbox intact when a flush dies mid-air", async () => {
    const { engine } = makeEngine(transport);
    await engine.capture({ initial: { vendor: "Cenex Co-op" } });

    transport.failNext = true;
    await expect(engine.flush()).rejects.toThrow(/no signal/);
    expect(await engine.pendingCount()).toBe(1);

    const report = await engine.flush();
    expect(report.applied).toBe(1);
    expect(await engine.pendingCount()).toBe(0);
  });
});

describe("SyncEngine flush", () => {
  let transport: FakeTransport;

  beforeEach(() => {
    transport = new FakeTransport();
  });

  it("uploads queued images before pushing the ops that reference them", async () => {
    const { engine } = makeEngine(transport);
    await engine.capture({ image: { base64: "aGk=", mediaType: "image/jpeg" } });

    const report = await engine.flush();
    expect(report.uploadedImages).toBe(1);
    expect(transport.uploads).toEqual(["img-id-1"]);
    expect(transport.pushes[0]?.ops[0]).toMatchObject({ kind: "capture", imageRef: "img-id-1" });
  });

  it("clears duplicates (a retry after a half-heard push) without re-applying", async () => {
    const { engine } = makeEngine(transport);
    await engine.capture({ initial: { vendor: "Cenex Co-op" } });
    transport.onPush = (request) => ({
      results: request.ops.map((op) => ({ opId: op.opId, status: "duplicate" })),
    });

    const report = await engine.flush();
    expect(report.duplicates).toBe(1);
    expect(await engine.pendingCount()).toBe(0);
  });

  it("drops rejected ops and reports why", async () => {
    const { engine } = makeEngine(transport);
    await engine.capture({ initial: { vendor: "Cenex Co-op" } });
    transport.onPush = (request) => ({
      results: request.ops.map((op) => ({
        opId: op.opId,
        status: "rejected",
        reason: "unknown Schedule F line",
      })),
    });

    const report = await engine.flush();
    expect(report.rejected).toEqual([{ opId: "id-2", reason: "unknown Schedule F line" }]);
    expect(await engine.pendingCount()).toBe(0);
  });

  it("stores pulled barn state and advances the cursor", async () => {
    const { engine, store } = makeEngine(transport);
    const barnReceipt = Receipt.capture({
      id: "r-barn",
      deviceId: "field-b",
      capturedAt: "2026-08-26T12:00:00.000Z",
      at: { wall: 500, counter: 0, node: "field-b" },
      imageRef: null,
      initial: { vendor: "Valley Vet" },
    });
    transport.onPull = () => ({ receipts: [receiptToDto(barnReceipt.toProps())], cursor: 7 });

    const report = await engine.flush();
    expect(report.pulled).toBe(1);
    expect(await store.loadCursor()).toBe(7);
    expect((await engine.list())[0]?.receipt.fields.vendor).toBe("Valley Vet");
  });

  it("folds pulled stamps into the clock so a slow local clock still wins the next edit", async () => {
    const { engine, store } = makeEngine(transport, () => 1_000);
    const farFuture: Hlc = { wall: 5_000_000, counter: 3, node: "barn" };
    const barnReceipt = Receipt.capture({
      id: "r-barn",
      deviceId: "barn",
      capturedAt: "2026-08-26T12:00:00.000Z",
      at: farFuture,
      imageRef: null,
    });
    transport.onPull = () => ({ receipts: [receiptToDto(barnReceipt.toProps())], cursor: 1 });
    await engine.flush();

    await engine.edit("r-barn", { vendor: "edited on the slow phone" });
    const [op] = await store.pendingOps();
    if (op?.kind !== "patch") throw new Error("expected a patch op");
    expect(compareHlc(op.at, farFuture)).toBe(1);

    const projected = (await engine.list())[0];
    expect(projected?.receipt.fields.vendor).toBe("edited on the slow phone");
  });
});
