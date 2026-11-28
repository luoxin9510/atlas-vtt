/**
 * Numbers read from a statblock for fixed-value initiative: the value, and the tie-break fields.
 *
 * A field is named as everywhere else (`findModifierField`): a dotted path (`stats.1`,
 * `resources.mana`), a key or template label in any spelling (`Basic Speed`), or a slot of a
 * scores field by its name (`attributes.DX`, or `DX` alone) or its index (`attributes.1`).
 */

import { findModifierField, type ModifierStatblock } from './modifierFields';

/** A plain decimal number as a statblock writes it: no dice, no prose, no unit. */
const PLAIN_NUMBER = /^[+\-−]?\d{1,9}(?:\.\d{1,6})?$/;

/** The number a value holds, decimals included; null for text, dice, empty values and anything not finite. */
export function plainNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return PLAIN_NUMBER.test(text) ? Number(text.replace(/−/, '-')) : null;
}

/** The number `statblock` holds in `field`; null where the field is missing or holds no plain number. */
export function readFixedNumber(statblock: ModifierStatblock, field: string): number | null {
  if (field.trim() === '') return null;
  const found = findModifierField(statblock, field);
  return found ? plainNumber(found.value) : null;
}
