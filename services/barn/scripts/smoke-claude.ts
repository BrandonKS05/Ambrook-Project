import { readFileSync } from "node:fs";

import type { ImageMediaType } from "@saddlebag/domain";

import { ClaudeCategorizer } from "../src/infrastructure/claude-categorizer.js";

/**
 * One-shot check that the Claude categorizer works with your credentials:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @saddlebag/barn smoke:claude [receipt.jpg]
 *
 * With no argument it categorizes typed facts; pass a photo to exercise the
 * vision path.
 */
if (process.env["ANTHROPIC_API_KEY"] === undefined) {
  console.error("Set ANTHROPIC_API_KEY first, e.g.:");
  console.error("  ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @saddlebag/barn smoke:claude [receipt.jpg]");
  process.exit(1);
}

function mediaType(path: string): ImageMediaType {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

const imagePath = process.argv[2];
const input =
  imagePath === undefined
    ? {
        vendor: "Cenex Co-op",
        memo: "87 gal diesel for the baler",
        totalCents: 31255,
        image: null,
      }
    : {
        vendor: null,
        memo: null,
        totalCents: null,
        image: { base64: readFileSync(imagePath).toString("base64"), mediaType: mediaType(imagePath) },
      };

console.log(imagePath === undefined ? "categorizing typed facts…" : `reading ${imagePath}…`);
const suggestion = await new ClaudeCategorizer().categorize(input);
console.log(JSON.stringify(suggestion, null, 2));
