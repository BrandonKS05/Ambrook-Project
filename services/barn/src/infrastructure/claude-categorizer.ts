import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import {
  formatCents,
  SCHEDULE_F_LINE_IDS,
  SCHEDULE_F_LINES,
  type Categorizer,
  type CategorizeInput,
  type CategorySuggestion,
} from "@saddlebag/domain";

const extractionSchema = z.object({
  line: z.enum(SCHEDULE_F_LINE_IDS),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  vendor: z.string().nullable(),
  totalCents: z.number().int().nullable(),
  purchasedAt: z.string().nullable(),
});

const LINE_REFERENCE = SCHEDULE_F_LINES.map(
  (entry) => `${entry.id} = line ${entry.line}, ${entry.label}`,
).join("\n");

const SYSTEM = `You are the receipt reader for a farm and ranch expense app.
Given a receipt photo and/or typed facts, pick the IRS Schedule F Part II
expense line and extract what the receipt itself shows.

Line reference:
${LINE_REFERENCE}

Rules:
- Prefer a specific line over F32 (Other expenses).
- rationale: one short sentence a rancher can sanity-check at a glance.
- vendor / totalCents / purchasedAt: only what you can actually read off the
  receipt — null for anything not visible. Never echo back facts you were
  told; those are already known.
- totalCents is the grand total in integer US cents. purchasedAt is yyyy-mm-dd.
- Unreadable or ambiguous receipt: still pick the likeliest line, with low
  confidence.`;

/**
 * Claude-backed categorizer: reads the photo, proposes a Schedule F line with
 * a confidence the review UI can display. Structured outputs guarantee the
 * response parses; the domain re-validates on attach.
 */
export class ClaudeCategorizer implements Categorizer {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { client?: Anthropic; model?: string } = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? process.env["SADDLEBAG_CLAUDE_MODEL"] ?? "claude-opus-5";
  }

  async categorize(input: CategorizeInput): Promise<CategorySuggestion | null> {
    const facts = [
      input.vendor === null ? null : `Vendor (typed by the user): ${input.vendor}`,
      input.memo === null ? null : `Memo (typed by the user): ${input.memo}`,
      input.totalCents === null ? null : `Total (typed by the user): ${formatCents(input.totalCents)}`,
    ].filter((line): line is string => line !== null);

    const content: Anthropic.ContentBlockParam[] = [];
    if (input.image !== null) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: input.image.mediaType, data: input.image.base64 },
      });
    }
    content.push({
      type: "text",
      text:
        facts.length > 0
          ? `Categorize this receipt.\n${facts.join("\n")}`
          : "Categorize this receipt from the photo alone.",
    });

    if (input.image === null && facts.length === 0) return null;

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(extractionSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) return null;

    return {
      line: parsed.line,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      source: "claude",
      extracted: {
        vendor: parsed.vendor,
        totalCents: parsed.totalCents !== null && parsed.totalCents >= 0 ? parsed.totalCents : null,
        purchasedAt:
          parsed.purchasedAt !== null && /^\d{4}-\d{2}-\d{2}$/.test(parsed.purchasedAt)
            ? parsed.purchasedAt
            : null,
      },
    };
  }
}
