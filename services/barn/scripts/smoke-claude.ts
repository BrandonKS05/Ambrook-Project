import { existsSync, readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

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

function fail(...lines: string[]): never {
  for (const text of lines) console.error(text);
  process.exit(1);
}

const key = process.env["ANTHROPIC_API_KEY"];
if (key === undefined) {
  fail(
    "Set ANTHROPIC_API_KEY first, e.g.:",
    "  ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @saddlebag/barn smoke:claude [receipt.jpg]",
  );
}
if (!key.startsWith("sk-ant-")) {
  fail(
    "ANTHROPIC_API_KEY doesn't look like an Anthropic key (they start with sk-ant-).",
    "An OpenAI key (sk-proj-…) will not work here. Get one at console.anthropic.com.",
  );
}

/** The image content type, read off the bytes — extensions lie. */
function sniff(bytes: Buffer): ImageMediaType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF") return "image/webp";
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return null;
}

const imagePath = process.argv[2];
let image: { base64: string; mediaType: ImageMediaType } | null = null;
if (imagePath !== undefined) {
  if (!existsSync(imagePath)) {
    fail(`No file at ${imagePath} — check the path (ls it first).`);
  }
  const bytes = readFileSync(imagePath);
  const mediaType = sniff(bytes);
  if (mediaType === null) {
    fail(
      `${imagePath} isn't a jpeg/png/webp/gif (iPhone photos are often HEIC).`,
      `Convert it first:  sips -s format jpeg "${imagePath}" --out receipt.jpg`,
    );
  }
  const base64 = bytes.toString("base64");
  if (base64.length > 5 * 1024 * 1024) {
    fail(
      `${imagePath} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB — over Claude's 5 MB image limit.`,
      `Shrink it first:  sips -Z 1600 "${imagePath}" --out receipt-small.jpg`,
    );
  }
  image = { base64, mediaType };
}

const input =
  image === null
    ? {
        vendor: "Cenex Co-op",
        memo: "87 gal diesel for the baler",
        totalCents: 31255,
        image: null,
      }
    : { vendor: null, memo: null, totalCents: null, image };

console.log(image === null ? "categorizing typed facts…" : `reading ${imagePath}…`);
try {
  const suggestion = await new ClaudeCategorizer().categorize(input);
  console.log(JSON.stringify(suggestion, null, 2));
  console.log("✓ Claude categorizer works — the barn will use it whenever this key is set.");
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    fail(
      "✗ 401 — the API rejected this key.",
      "It must be a live Anthropic key from console.anthropic.com (starts with sk-ant-).",
    );
  }
  if (error instanceof Anthropic.APIError) {
    fail(`✗ API error ${error.status}: ${error.message}`);
  }
  throw error;
}
