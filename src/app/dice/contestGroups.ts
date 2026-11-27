import type { RollContest } from './contestTypes';

/** A roll of a list that stands alone, or the two rolls of one contest. */
export type ContestGroup<T> =
  | { kind: 'roll'; roll: T }
  | { kind: 'contest'; first: T; second: T };

/**
 * Groups a roll list for display: the two rolls of a contest (same contest id, one of each side) become
 * one `contest` group at the place of whichever of them comes first; every other roll, a side whose
 * partner is not in the list included, stays a `roll`. Works for a list in either order.
 */
export function groupContests<T>(rolls: readonly T[], contestOf: (roll: T) => Pick<RollContest, 'id' | 'side'> | undefined): ContestGroup<T>[] {
  const sides = new Map<string, { first?: T; second?: T }>();
  for (const roll of rolls) {
    const contest = contestOf(roll);
    if (contest === undefined) continue;
    const pair = sides.get(contest.id) ?? {};
    pair[contest.side] ??= roll;
    sides.set(contest.id, pair);
  }
  const groups: ContestGroup<T>[] = [];
  const emitted = new Set<string>();
  for (const roll of rolls) {
    const contest = contestOf(roll);
    const pair = contest && sides.get(contest.id);
    if (!contest || !pair || pair.first === undefined || pair.second === undefined || pair[contest.side] !== roll) {
      groups.push({ kind: 'roll', roll });
    } else if (!emitted.has(contest.id)) {
      emitted.add(contest.id);
      groups.push({ kind: 'contest', first: pair.first, second: pair.second });
    }
  }
  return groups;
}
