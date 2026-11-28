import type { App } from 'obsidian';
import { useCallback, useEffect, useRef } from 'react';
import { useAtlasStore, useViewStoreHook } from '../react/ViewStoreContext';
import { readStatblockRecord } from '../statblocks/resolve/statblockRecord';
import type { InitiativeRules } from '../types/initiativeRulesTypes';
import { readFixedInitiative } from './fixedInitiativeValues';

/**
 * Fixed-value initiative (`rules.value`): reads the combatants' statblocks and writes their numbers.
 * Returns a function that reads `entryId`'s, or everyone's where none is given; a number the GM
 * typed stays, and the read does nothing where the scene changed or the tracker went meanwhile.
 *
 * The same read runs by itself whenever a combatant is waiting for its number, which is how every
 * way of joining the fight (the map, the library, beside the map, an undo) gets its value, and how
 * a number the GM cleared comes back. A combatant whose statblock holds none stays waiting, and is
 * not read again until the set of waiting combatants changes.
 */
export function useFixedInitiative(app: App, rules: InitiativeRules): (entryId?: string) => Promise<void> {
  const store = useViewStoreHook();
  const mounted = useRef(true);
  const fixed = rules.mode === 'turn-order' && rules.value !== undefined;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const readNow = useCallback(async (ids?: readonly string[]): Promise<void> => {
    const before = store.getState();
    if (!fixed || before.isMapLoading) return;
    const entries = before.initiative.entries.filter((entry) => ids === undefined || ids.includes(entry.id));
    if (entries.length === 0) return;
    const reads = await readFixedInitiative(entries, before.objects.tokens, rules, async (path) => {
      const record = await readStatblockRecord(app, path);
      return record && { fields: record.record, meanings: record.meanings, labels: record.labels, fantasy: record.fantasy };
    });
    const now = store.getState();
    if (!mounted.current || now.isMapLoading || now.mapPath !== before.mapPath) return;
    now.applyFixedInitiative(reads);
  }, [app, store, rules, fixed]);

  // Entries waiting for a number the GM has not typed: a string, so a read that finds none changes nothing
  const waiting = useAtlasStore((state) => state.initiative.entries.filter((entry) => entry.awaitingInitiative && !entry.fixedByHand).map((entry) => entry.id).join('\n'));
  useEffect(() => {
    if (waiting === '') return;
    readNow(waiting.split('\n')).catch((error: unknown) => console.error('[Atlas VTT] Could not read the initiative of the combatants:', error));
  }, [waiting, readNow]);

  return useCallback((entryId?: string) => readNow(entryId === undefined ? undefined : [entryId]), [readNow]);
}
