import type { RollEntry } from '../protocol/index.ts';
import { groupContests } from '../../dice/contestGroups';
import type { ShownEntry } from './LogState.ts';

/**
 * The entries as the log shows them: the two rolls of one contest (one roller, one contest id, one of
 * each side) become one row, the second's (the roll that holds the verdict), which gets the first as
 * its `partner`. Every other entry, a side whose partner is not in the log included, stays as it is.
 */
export function pairRolls(entries: readonly ShownEntry[]): { readonly visible: readonly ShownEntry[]; readonly partners: ReadonlyMap<string, RollEntry> } {
  const groups = groupContests(entries, (entry) => (entry.kind === 'roll' && entry.roll.contest ? { id: `${entry.who}/${entry.roll.contest.id}`, side: entry.roll.contest.side } : undefined));
  const partners = new Map<string, RollEntry>();
  for (const group of groups) {
    if (group.kind === 'contest' && group.first.kind === 'roll') partners.set(group.second.id, group.first);
  }
  const absorbed = new Set([...partners.values()].map((entry) => entry.id));
  return { visible: absorbed.size === 0 ? entries : entries.filter((entry) => !absorbed.has(entry.id)), partners };
}
