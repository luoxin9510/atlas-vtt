const BASE_MS = 500;
const MAX_MS = 30_000;

/** Reconnect delay: `min(30 s, 500 ms · 2^attempt)` scaled by a random factor in 0.5..1.0. */
export function backoffMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * (0.5 + 0.5 * random()));
}
