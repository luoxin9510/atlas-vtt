/** Reading, storing and comparing the fixed-value part of initiative rules: the value field and the tie-break fields. */

import type { InitiativeFieldRef, InitiativeRules } from '../types/initiativeRulesTypes';

/** The most tie-break fields a preset names. */
export const MAX_TIE_BREAK_FIELDS = 4;

/** A stored field reference: its field trimmed; none without a field. */
export function parseFieldRef(raw: unknown): InitiativeFieldRef | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { field } = raw as Record<string, unknown>;
  return typeof field === 'string' && field.trim() !== '' ? { field: field.trim() } : undefined;
}

export type FixedParts = Pick<InitiativeRules, 'value' | 'tieBreak'>;

/**
 * The fixed-value parts of `raw` as they are stored. They count in turn order only: in any other
 * mode they are ignored. Blank entries are dropped, and no more than `MAX_TIE_BREAK_FIELDS` kept.
 */
export function fixedParts(raw: { mode?: unknown; value?: unknown; tieBreak?: unknown }): FixedParts {
  if (raw.mode !== 'turn-order') return {};
  const value = parseFieldRef(raw.value);
  const tieBreak = Array.isArray(raw.tieBreak)
    ? raw.tieBreak.map(parseFieldRef).filter((ref): ref is InitiativeFieldRef => ref !== undefined).slice(0, MAX_TIE_BREAK_FIELDS)
    : [];
  return { ...(value && { value }), ...(tieBreak.length > 0 && { tieBreak }) };
}

/** Whether two rules read the value and the tie-break from the same fields. */
export function sameFixedParts(a: FixedParts, b: FixedParts): boolean {
  const fields = (parts: FixedParts): string => JSON.stringify([parts.value?.field.trim() ?? null, (parts.tieBreak ?? []).map((ref) => ref.field.trim())]);
  return fields(a) === fields(b);
}
