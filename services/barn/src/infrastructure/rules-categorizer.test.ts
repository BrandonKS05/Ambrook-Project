import { describe, expect, it } from "vitest";

import { RulesCategorizer } from "./rules-categorizer.js";

const categorizer = new RulesCategorizer();

describe("RulesCategorizer", () => {
  it("matches fuel language to Schedule F line 19", async () => {
    const suggestion = await categorizer.categorize({
      vendor: "Cenex Co-op",
      memo: "diesel for the baler",
      totalCents: 31255,
      image: null,
    });
    expect(suggestion).toMatchObject({ line: "F19", source: "rules" });
    expect(suggestion?.extracted).toEqual({ vendor: null, totalCents: null, purchasedAt: null });
  });

  it("returns null when nothing matches or there is nothing to read", async () => {
    expect(
      await categorizer.categorize({ vendor: "Zzyzx LLC", memo: null, totalCents: null, image: null }),
    ).toBeNull();
    expect(
      await categorizer.categorize({ vendor: null, memo: null, totalCents: null, image: null }),
    ).toBeNull();
  });
});
