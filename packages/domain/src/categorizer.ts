import type { ScheduleFLineId } from "./schedule-f.js";

/** What a categorizer could read off the receipt itself. */
export interface ExtractedReceiptFacts {
  vendor: string | null;
  totalCents: number | null;
  /** ISO calendar date (yyyy-mm-dd). */
  purchasedAt: string | null;
}

export interface CategorySuggestion {
  line: ScheduleFLineId;
  /** 0..1 — how sure the categorizer is about `line`. */
  confidence: number;
  /** One short sentence a reviewer can sanity-check. */
  rationale: string;
  source: "rules" | "claude";
  extracted: ExtractedReceiptFacts;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface CategorizeInput {
  vendor: string | null;
  memo: string | null;
  totalCents: number | null;
  image: { base64: string; mediaType: ImageMediaType } | null;
}

/** Port: proposes a Schedule F line for a captured receipt. Adapters live in the barn. */
export interface Categorizer {
  categorize(input: CategorizeInput): Promise<CategorySuggestion | null>;
}
