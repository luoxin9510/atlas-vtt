/**
 * Damage survives a re-import (P3c decision 15): a resource field of a note that stores a current value (`12/27`, or
 * `{ current: 12, max: 27 }`) keeps it, clamped to the maximum the file gives now. Pure.
 */

import { parseResourceValue } from '../resources/resourceFields';
import type { FieldValue } from '../statblocks/model/templateTypes';

type Stored = { current: number; shape: 'text' } | { current: number; shape: 'map'; key: 'current' | 'value'; map: { [key: string]: FieldValue } };

const isMap = (value: unknown): value is { [key: string]: FieldValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The current value a note's value stores itself, with how it is written; null for a bare maximum or anything else. */
function storedCurrent(value: FieldValue | undefined): Stored | null {
  if (typeof value === 'string') {
    const fraction = value.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*\d+(?:\.\d+)?$/);
    return fraction?.[1] === undefined ? null : { current: Number(fraction[1]), shape: 'text' };
  }
  if (!isMap(value)) return null;
  const key = typeof value.current === 'number' ? 'current' : typeof value.value === 'number' ? 'value' : null;
  const current = key === null ? undefined : value[key];
  return key !== null && typeof current === 'number' ? { current, shape: 'map', key, map: value } : null;
}

/**
 * The imported values with each current value the note stores kept, clamped to the imported
 * maximum. Only fields `isResource` names (the template's resources, never a rating of `1/2` or an
 * attribute with a modifier) are looked at; every other value is the file's as it is.
 */
export function keepNoteCurrent(
  frontmatter: Readonly<Record<string, FieldValue | undefined>>,
  imported: Readonly<Record<string, FieldValue>>,
  isResource: (key: string) => boolean,
): Record<string, FieldValue> {
  const kept: Record<string, FieldValue> = {};
  for (const [key, next] of Object.entries(imported)) {
    const stored = isResource(key) ? storedCurrent(frontmatter[key]) : null;
    const max = stored === null ? null : parseResourceValue(isMap(next) ? { max: next.max } : next)?.max ?? null;
    if (stored === null || max === null) {
      kept[key] = next;
      continue;
    }
    const current = Math.min(stored.current, max);
    if (stored.shape === 'text') kept[key] = `${current}/${max}`;
    else kept[key] = isMap(next) ? { ...next, [stored.key]: current } : { ...stored.map, [stored.key]: current, max };
  }
  return kept;
}
