import Fastify, { type FastifyInstance } from "fastify";

import {
  imageUploadRequestSchema,
  syncPullRequestSchema,
  syncPushRequestSchema,
  type OpResultDto,
} from "@saddlebag/contracts";
import { InvariantViolationError, type ReceiptOp, type ReceiptStore } from "@saddlebag/domain";
import { opFromDto, receiptToDto } from "@saddlebag/sync/codec";

import type { ApplyPush } from "../application/apply-push.js";
import type { BlobStore } from "../application/ports.js";
import type { SuggestCategories } from "../application/suggest-categories.js";
import { REVIEW_PAGE } from "./review-page.js";

export interface BarnDeps {
  applyPush: ApplyPush;
  suggest: SuggestCategories;
  receipts: ReceiptStore;
  blobs: BlobStore;
}

function formatIssues(error: {
  issues: Array<{ path: Array<string | number | symbol>; message: string }>;
}): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
}

export function buildServer(deps: BarnDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: 25 * 1024 * 1024 });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof InvariantViolationError) {
      return reply.status(400).send({ code: "INVALID", message: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ code: "INTERNAL", message: "internal error" });
  });

  app.post("/sync/push", async (request, reply) => {
    const parsed = syncPushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: formatIssues(parsed.error) });
    }
    const ops: ReceiptOp[] = [];
    const undecodable: OpResultDto[] = [];
    for (const dto of parsed.data.ops) {
      try {
        ops.push(opFromDto(dto));
      } catch (error) {
        undecodable.push({
          opId: dto.opId,
          status: "rejected",
          reason: error instanceof Error ? error.message : "undecodable op",
        });
      }
    }
    const { results, touched } = await deps.applyPush.execute(ops);
    await deps.suggest.execute(touched);
    return { results: [...results, ...undecodable] };
  });

  app.post("/sync/pull", async (request, reply) => {
    const parsed = syncPullRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: formatIssues(parsed.error) });
    }
    const { receipts, cursor } = await deps.receipts.changedSince(parsed.data.cursor);
    return { receipts: receipts.map((receipt) => receiptToDto(receipt.toProps())), cursor };
  });

  app.post("/images/:ref", async (request, reply) => {
    const parsed = imageUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: formatIssues(parsed.error) });
    }
    await deps.blobs.put((request.params as { ref: string }).ref, parsed.data);
    return { ok: true };
  });

  app.get("/images/:ref", async (request, reply) => {
    const image = await deps.blobs.get((request.params as { ref: string }).ref);
    if (image === null) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "no such image" });
    }
    return reply.header("content-type", image.mediaType).send(Buffer.from(image.base64, "base64"));
  });

  app.get("/receipts", async () => {
    const { receipts } = await deps.receipts.changedSince(0);
    return { receipts: receipts.map((receipt) => receiptToDto(receipt.toProps())) };
  });

  app.get("/", async (_request, reply) => reply.type("text/html").send(REVIEW_PAGE));
  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
