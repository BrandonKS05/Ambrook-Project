import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";

import {
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncPullRequest,
  type SyncPushRequest,
} from "@saddlebag/contracts";
import { InMemoryClientStore, SyncEngine, type SyncTransport } from "@saddlebag/sync";

import { ApplyPush } from "../application/apply-push.js";
import { SuggestCategories } from "../application/suggest-categories.js";
import { InMemoryBlobStore } from "../infrastructure/blob-store.js";
import { InMemoryReceiptStore } from "../infrastructure/in-memory-receipt-store.js";
import { RulesCategorizer } from "../infrastructure/rules-categorizer.js";
import { buildServer } from "./server.js";

/** Drives the real HTTP layer with no sockets. Remembers pushes so tests can replay a "lost response". */
class InjectTransport implements SyncTransport {
  lastPush: SyncPushRequest | null = null;

  constructor(private readonly app: FastifyInstance) {}

  async push(request: SyncPushRequest) {
    this.lastPush = request;
    const response = await this.app.inject({ method: "POST", url: "/sync/push", payload: request });
    if (response.statusCode !== 200) throw new Error(`push failed: ${response.statusCode}`);
    return syncPushResponseSchema.parse(response.json());
  }

  async replayLastPush() {
    if (this.lastPush === null) throw new Error("nothing to replay");
    const response = await this.app.inject({
      method: "POST",
      url: "/sync/push",
      payload: this.lastPush,
    });
    return syncPushResponseSchema.parse(response.json());
  }

  async pull(request: SyncPullRequest) {
    const response = await this.app.inject({ method: "POST", url: "/sync/pull", payload: request });
    if (response.statusCode !== 200) throw new Error(`pull failed: ${response.statusCode}`);
    return syncPullResponseSchema.parse(response.json());
  }

  async uploadImage(ref: string, base64: string, mediaType: string) {
    const response = await this.app.inject({
      method: "POST",
      url: `/images/${encodeURIComponent(ref)}`,
      payload: { base64, mediaType },
    });
    if (response.statusCode !== 200) throw new Error(`upload failed: ${response.statusCode}`);
  }
}

function device(app: FastifyInstance, deviceId: string, clock: { now: number }) {
  let nextId = 0;
  const transport = new InjectTransport(app);
  const engine = new SyncEngine({
    store: new InMemoryClientStore(),
    transport,
    deviceId,
    now: () => clock.now,
    newId: () => `${deviceId}-${(nextId += 1)}`,
  });
  return { engine, transport };
}

describe("barn end to end", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const receipts = new InMemoryReceiptStore();
    const blobs = new InMemoryBlobStore();
    app = buildServer({
      applyPush: new ApplyPush(receipts),
      suggest: new SuggestCategories(receipts, new RulesCategorizer(), blobs),
      receipts,
      blobs,
    });
  });

  it("runs the whole ride: capture offline → sync → AI suggestion → approve → other devices see it", async () => {
    const clock = { now: 1_000 };
    const phone = device(app, "field-a", clock);

    const receiptId = await phone.engine.capture({
      initial: { vendor: "Cenex Co-op", memo: "diesel for the baler", totalCents: 31255 },
      image: { base64: "aGF5", mediaType: "image/jpeg" },
    });

    clock.now = 2_000;
    const first = await phone.engine.flush();
    expect(first).toMatchObject({ uploadedImages: 1, applied: 1, pulled: 1 });

    const [local] = await phone.engine.list();
    expect(local?.receipt.status).toBe("suggested");
    expect(local?.receipt.suggestion).toMatchObject({ line: "F19", source: "rules" });
    expect(local?.pendingOps).toBe(0);

    clock.now = 3_000;
    await phone.engine.approve(receiptId, "F19");
    const second = await phone.engine.flush();
    expect(second.applied).toBe(1);

    const laptop = device(app, "field-b", { now: 9_000 });
    await laptop.engine.flush();
    const [remote] = await laptop.engine.list();
    expect(remote?.receipt.status).toBe("approved");
    expect(remote?.receipt.fields).toMatchObject({ vendor: "Cenex Co-op", category: "F19" });
  });

  it("answers a replayed push (lost response) with duplicates, changing nothing", async () => {
    const clock = { now: 1_000 };
    const phone = device(app, "field-a", clock);
    await phone.engine.capture({ initial: { vendor: "Valley Vet", memo: "LA-300 + syringes" } });
    await phone.engine.flush();

    const replayed = await phone.transport.replayLastPush();
    expect(replayed.results.map((result) => result.status)).toEqual(["duplicate"]);

    const laptop = device(app, "field-b", { now: 9_000 });
    await laptop.engine.flush();
    expect(await laptop.engine.list()).toHaveLength(1);
  });

  it("arbitrates a concurrent edit: later stamp wins, loser lands in the conflict log", async () => {
    const clockA = { now: 1_000 };
    const clockB = { now: 1_500 };
    const phoneA = device(app, "field-a", clockA);
    const phoneB = device(app, "field-b", clockB);

    const receiptId = await phoneA.engine.capture({ initial: { vendor: "Tractor Supply Co" } });
    await phoneA.engine.flush();
    await phoneB.engine.flush();

    clockA.now = 5_000;
    await phoneA.engine.edit(receiptId, { category: "F28" });
    clockB.now = 6_000;
    await phoneB.engine.edit(receiptId, { category: "F16" });

    await phoneB.engine.flush();
    const reportA = await phoneA.engine.flush();

    expect(reportA.conflicts).toEqual([
      { field: "category", kept: "F16", discarded: "F28", discardedFrom: "field-a" },
    ]);
    const [merged] = await phoneA.engine.list();
    expect(merged?.receipt.fields.category).toBe("F16");
    expect(merged?.receipt.conflictLog).toHaveLength(1);
  });

  it("rejects a well-shaped op with a bad Schedule F line, without poisoning the batch", async () => {
    const clock = { now: 1_000 };
    const phone = device(app, "field-a", clock);
    await phone.engine.capture({ initial: { vendor: "Cenex Co-op" } });
    await phone.engine.flush();

    const response = await app.inject({
      method: "POST",
      url: "/sync/push",
      payload: {
        deviceId: "field-a",
        ops: [
          {
            kind: "approve",
            opId: "bad-op-1",
            receiptId: (await phone.engine.list())[0]?.receipt.id,
            deviceId: "field-a",
            baseRev: 1,
            at: "000000000002000-000000-field-a",
            category: "F99",
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const parsed = syncPushResponseSchema.parse(response.json());
    expect(parsed.results[0]).toMatchObject({ status: "rejected" });
    expect((parsed.results[0] as { reason: string }).reason).toContain("F99");
  });

  it("serves uploaded images back with their media type, and refuses traversal refs", async () => {
    const clock = { now: 1_000 };
    const phone = device(app, "field-a", clock);
    await phone.engine.capture({
      initial: { vendor: "Cenex Co-op" },
      image: { base64: "aGF5", mediaType: "image/jpeg" },
    });
    await phone.engine.flush();

    const [receipt] = await phone.engine.list();
    const image = await app.inject({ method: "GET", url: `/images/${receipt?.receipt.imageRef}` });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/jpeg");
    expect(image.rawPayload.toString("utf8")).toBe("hay");

    const traversal = await app.inject({ method: "GET", url: "/images/..%2F..%2Fetc" });
    expect(traversal.statusCode).toBe(400);

    const unsafe = await app.inject({ method: "GET", url: "/images/evil.ref" });
    expect(unsafe.statusCode).toBe(400);
  });

  it("serves the review page", async () => {
    const page = await app.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("saddlebag barn");
  });
});
