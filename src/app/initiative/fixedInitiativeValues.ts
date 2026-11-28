/** Reading the fixed initiative of the combatants from their linked statblocks. */

import type { TokenEntity } from '../types';
import type { InitiativeRules } from '../types/initiativeRulesTypes';
import type { InitiativeEntry } from '../types/initiativeTypes';
import type { FixedRead } from './applyFixed';
import { readFixedNumber } from './fixedInitiativeReading';
import type { ModifierStatblock } from './modifierFields';

/** The note a token links, if any. */
function linkedNote(token: TokenEntity | undefined): string | undefined {
  return token?.kind === 'character' ? token.statblockPath?.trim() || undefined : undefined;
}

/**
 * What the statblocks of `entries` hold for the rules' `value` and `tieBreak` fields, by entry id,
 * reading each linked note once through `read` (the statblock resolver). A combatant whose token
 * links no readable statblock, or whose statblock lacks the value, has none (`value: null`); a
 * tie-break field a statblock lacks reads 0.
 */
export async function readFixedInitiative(
  entries: readonly InitiativeEntry[],
  tokens: Readonly<Record<string, TokenEntity>>,
  rules: Pick<InitiativeRules, 'value' | 'tieBreak'>,
  read: (path: string) => Promise<ModifierStatblock | null>,
): Promise<Map<string, FixedRead>> {
  const notes = new Map(entries.map((entry) => [entry.id, linkedNote(tokens[entry.tokenId])] as const));
  const paths = [...new Set([...notes.values()].filter((path): path is string => path !== undefined))];
  const records = new Map(await Promise.all(paths.map(async (path) => [path, await read(path)] as const)));
  const fields = rules.tieBreak ?? [];
  return new Map(entries.map((entry): [string, FixedRead] => {
    const note = notes.get(entry.id);
    const statblock = note === undefined ? null : records.get(note) ?? null;
    return [entry.id, {
      value: statblock && rules.value ? readFixedNumber(statblock, rules.value.field) : null,
      tieBreaks: fields.map((ref) => (statblock ? readFixedNumber(statblock, ref.field) : null) ?? 0),
    }];
  }));
}
