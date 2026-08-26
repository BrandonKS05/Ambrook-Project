import { InvariantViolationError } from "./errors.js";

/**
 * Hybrid logical clock (Kulkarni et al.). Close to wall time for humans, but
 * totally ordered and monotonic across devices whose clocks drift — exactly
 * the situation of a phone that spent the afternoon in a dead zone.
 */
export interface Hlc {
  /** Wall-clock milliseconds observed when the stamp was issued. */
  readonly wall: number;
  /** Orders events sharing one wall millisecond (or issued on a stalled clock). */
  readonly counter: number;
  /** Issuing device — the final total-order tiebreak. */
  readonly node: string;
}

/** Stamp a local event. Never goes backwards, even if the wall clock does. */
export function hlcNow(prev: Hlc | null, wallMs: number, node: string): Hlc {
  assertNode(node);
  if (prev === null || wallMs > prev.wall) {
    return { wall: wallMs, counter: 0, node };
  }
  return { wall: prev.wall, counter: prev.counter + 1, node };
}

/** Fold a remote stamp into the local clock so later local stamps sort after it. */
export function hlcReceive(prev: Hlc | null, remote: Hlc, wallMs: number, node: string): Hlc {
  assertNode(node);
  const localWall = prev?.wall ?? 0;
  if (wallMs > localWall && wallMs > remote.wall) {
    return { wall: wallMs, counter: 0, node };
  }
  if (localWall === remote.wall) {
    return { wall: localWall, counter: Math.max(prev?.counter ?? 0, remote.counter) + 1, node };
  }
  if (localWall > remote.wall) {
    return { wall: localWall, counter: (prev?.counter ?? 0) + 1, node };
  }
  return { wall: remote.wall, counter: remote.counter + 1, node };
}

export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.node !== b.node) return a.node < b.node ? -1 : 1;
  return 0;
}

const WALL_DIGITS = 15;
const COUNTER_DIGITS = 6;

/** Sortable encoding: lexicographic order of the strings equals {@link compareHlc} order. */
export function hlcToString(hlc: Hlc): string {
  return [
    String(hlc.wall).padStart(WALL_DIGITS, "0"),
    String(hlc.counter).padStart(COUNTER_DIGITS, "0"),
    hlc.node,
  ].join("-");
}

export function hlcFromString(text: string): Hlc {
  const match = /^(\d{15})-(\d{6})-(.+)$/.exec(text);
  if (!match) {
    throw new InvariantViolationError(`not an HLC string: "${text}"`);
  }
  return { wall: Number(match[1]), counter: Number(match[2]), node: match[3] as string };
}

function assertNode(node: string): void {
  if (node.length === 0) {
    throw new InvariantViolationError("HLC node id must be non-empty");
  }
}
