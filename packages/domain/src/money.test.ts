import { describe, expect, it } from "vitest";

import { formatCents, parseMoney } from "./money.js";

describe("formatCents", () => {
  it("formats with thousands separators and two decimals", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(100000000)).toBe("$1,000,000.00");
  });

  it("formats negatives with a leading sign", () => {
    expect(formatCents(-18437)).toBe("-$184.37");
  });
});

describe("parseMoney", () => {
  it("parses dollar strings to integer cents", () => {
    expect(parseMoney("$1,234.56")).toBe(123456);
    expect(parseMoney("12")).toBe(1200);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney(" 184.37 ")).toBe(18437);
  });

  it("returns null for anything that is not a plain amount", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("$-3")).toBeNull();
    expect(parseMoney(".50")).toBeNull();
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});
