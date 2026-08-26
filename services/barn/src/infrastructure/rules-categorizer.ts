import {
  scheduleFLabel,
  type Categorizer,
  type CategorizeInput,
  type CategorySuggestion,
  type ScheduleFLineId,
} from "@saddlebag/domain";

interface Rule {
  pattern: RegExp;
  line: ScheduleFLineId;
}

const RULES: Rule[] = [
  { pattern: /\b(diesel|gasoline|fuel|cenex|conoco|sinclair|petro)\b/i, line: "F19" },
  { pattern: /\b(vet|veterinary|veterinarian|animal health|breeding|vaccine|la-?300)\b/i, line: "F31" },
  { pattern: /\b(feed|purina|nutrena|mineral tub|salt block|hay|silage)\b/i, line: "F16" },
  { pattern: /\b(seed|pioneer|dekalb|asgrow|nursery|seedling)\b/i, line: "F26" },
  { pattern: /\b(fertilizer|nutrien|anhydrous|urea|lime|agronomy)\b/i, line: "F17" },
  { pattern: /\b(herbicide|pesticide|fungicide|glyphosate|chemical)\b/i, line: "F11" },
  { pattern: /\b(repair|parts|napa|o'?reilly|tire|welding|hydraulic)\b/i, line: "F25" },
  { pattern: /\b(freight|hauling|trucking)\b/i, line: "F18" },
  { pattern: /\b(electric|power co-?op|utility|propane|water district)\b/i, line: "F30" },
  { pattern: /\b(rent|lease)\b/i, line: "F24" },
  { pattern: /\b(insurance|premium)\b/i, line: "F20" },
  { pattern: /\b(tractor supply|fence|t-?post|staples|baling wire|twine|hardware|lumber|supplies)\b/i, line: "F28" },
];

/**
 * Deterministic fallback categorizer: keyword rules over vendor + memo.
 * Needs no API key and reads nothing off the image, which is why its
 * `extracted` facts are always empty — it derived nothing new.
 */
export class RulesCategorizer implements Categorizer {
  async categorize(input: CategorizeInput): Promise<CategorySuggestion | null> {
    const text = [input.vendor, input.memo].filter((part) => part !== null).join(" ");
    if (text.length === 0) return null;
    for (const rule of RULES) {
      const match = rule.pattern.exec(text);
      if (match === null) continue;
      return {
        line: rule.line,
        confidence: 0.6,
        rationale: `Rule match on "${match[0]}" → ${scheduleFLabel(rule.line)}.`,
        source: "rules",
        extracted: { vendor: null, totalCents: null, purchasedAt: null },
      };
    }
    return null;
  }
}
