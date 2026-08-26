import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Categorizer } from "@saddlebag/domain";
import type { FastifyInstance } from "fastify";

import { ApplyPush } from "./application/apply-push.js";
import { SuggestCategories } from "./application/suggest-categories.js";
import { ClaudeCategorizer } from "./infrastructure/claude-categorizer.js";
import { FsBlobStore } from "./infrastructure/blob-store.js";
import { RulesCategorizer } from "./infrastructure/rules-categorizer.js";
import { SqliteReceiptStore } from "./infrastructure/sqlite-receipt-store.js";
import { buildServer } from "./http/server.js";

export interface BarnConfig {
  dbPath: string;
  blobDir: string;
  categorizer?: Categorizer;
}

export function composeBarn(config: BarnConfig): { app: FastifyInstance; categorizerMode: string } {
  if (config.dbPath !== ":memory:") {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }
  const receipts = SqliteReceiptStore.open(config.dbPath);
  const blobs = new FsBlobStore(config.blobDir);
  const [categorizer, categorizerMode] = config.categorizer
    ? [config.categorizer, "custom"]
    : categorizerFromEnv();
  const app = buildServer({
    applyPush: new ApplyPush(receipts),
    suggest: new SuggestCategories(receipts, categorizer, blobs),
    receipts,
    blobs,
  });
  return { app, categorizerMode };
}

function categorizerFromEnv(): [Categorizer, string] {
  const mode =
    process.env["SADDLEBAG_CATEGORIZER"] ??
    (process.env["ANTHROPIC_API_KEY"] !== undefined ? "claude" : "rules");
  return mode === "claude"
    ? [new ClaudeCategorizer(), "claude"]
    : [new RulesCategorizer(), "rules"];
}
