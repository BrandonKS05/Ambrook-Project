import { describe, expect, it } from "vitest";

import { compareHlc, hlcFromString, hlcNow, hlcReceive, hlcToString, type Hlc } from "./hlc.js";

const hlc = (wall: number, counter = 0, node = "field-a"): Hlc => ({ wall, counter, node });

describe("hlcNow", () => {
  it("tracks the wall clock while it moves forward", () => {
    expect(hlcNow(hlc(1000), 2000, "field-a")).toEqual(hlc(2000));
  });

  it("increments the counter when the wall clock stalls", () => {
    expect(hlcNow(hlc(1000, 3), 1000, "field-a")).toEqual(hlc(1000, 4));
  });

  it("never goes backwards even when the wall clock does", () => {
    const stamped = hlcNow(hlc(5000), 1000, "field-a");
    expect(compareHlc(stamped, hlc(5000))).toBe(1);
    expect(stamped.wall).toBe(5000);
  });
});

describe("hlcReceive", () => {
  it("folds a remote stamp from a fast clock so later local stamps sort after it", () => {
    const merged = hlcReceive(hlc(1000), hlc(9000, 2, "barn"), 1500, "field-a");
    expect(compareHlc(merged, hlc(9000, 2, "barn"))).toBe(1);

    const next = hlcNow(merged, 1600, "field-a");
    expect(compareHlc(next, merged)).toBe(1);
  });

  it("returns to plain wall time once the local clock passes everything seen", () => {
    expect(hlcReceive(hlc(1000), hlc(2000, 5, "barn"), 3000, "field-a")).toEqual(hlc(3000));
  });

  it("handles a null local clock", () => {
    const merged = hlcReceive(null, hlc(2000, 1, "barn"), 1000, "field-a");
    expect(compareHlc(merged, hlc(2000, 1, "barn"))).toBe(1);
  });
});

describe("compareHlc", () => {
  it("orders by wall, then counter, then node", () => {
    expect(compareHlc(hlc(1), hlc(2))).toBe(-1);
    expect(compareHlc(hlc(1, 1), hlc(1, 0))).toBe(1);
    expect(compareHlc(hlc(1, 1, "a"), hlc(1, 1, "b"))).toBe(-1);
    expect(compareHlc(hlc(1, 1, "a"), hlc(1, 1, "a"))).toBe(0);
  });
});

describe("string encoding", () => {
  it("round-trips", () => {
    const original = hlc(1756222345678, 42, "field-a");
    expect(hlcFromString(hlcToString(original))).toEqual(original);
  });

  it("sorts lexicographically in compareHlc order", () => {
    const stamps = [hlc(2), hlc(1, 5), hlc(1, 0, "z"), hlc(1, 0, "a"), hlc(10)];
    const byCompare = [...stamps].sort(compareHlc).map(hlcToString);
    const byString = stamps.map(hlcToString).sort();
    expect(byString).toEqual(byCompare);
  });

  it("rejects strings that are not HLC encodings", () => {
    expect(() => hlcFromString("yesterday-ish")).toThrow(/not an HLC string/);
  });
});
