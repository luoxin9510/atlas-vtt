/**
 * What a rule pack's importer hands over is untrusted (P3c decision 32): a pack is code of someone
 * else's. The character is checked and copied before Atlas uses any of it: a name that is text, a
 * template id that is text, values that are plain data (text, finite numbers, true or false, null,
 * lists and plain objects) within a size cap, without the keys an import never writes, the keys
 * Obsidian owns or the ones that could reach an object's prototype. Whether the template exists is
 * asked of the vault (`ImportDeps.templateExists`). Pure.
 */

import { t } from '../i18n';
import type { FieldValue } from '../statblocks/model/templateTypes';
import { importableValues } from './importNotePatches';
import type { ImportedCharacter } from './importerTypes';

export { MAX_PORTRAIT_BYTES } from './portraitFormat';

/** The longest name a note takes. */
const MAX_NAME_LENGTH = 200;
/** The most the values may be, as the text of their JSON. */
const MAX_VALUES_LENGTH = 1_000_000;
/** The deepest a value may nest; deeper is not a character sheet. */
const MAX_DEPTH = 64;
/** Keys that would reach the prototype of the object they are written to. */
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** A value that cannot be kept; its message is the reason. */
class NotData extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A copy of `value` that holds plain data only, `undefined` for a property with none (dropped); throws `NotData` otherwise. */
function copiedData(value: unknown, ancestors: readonly object[]): FieldValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NotData();
    return value;
  }
  if (!isObject(value) || ancestors.length >= MAX_DEPTH || ancestors.includes(value)) throw new NotData();
  const path = [...ancestors, value];
  if (Array.isArray(value)) {
    return value.map((item): FieldValue => {
      const copy = copiedData(item, path);
      if (copy === undefined) throw new NotData();
      return copy;
    });
  }
  if (!isPlainObject(value)) throw new NotData();
  const copy: { [key: string]: FieldValue } = {};
  for (const key of Object.keys(value)) {
    if (PROTOTYPE_KEYS.has(key)) continue;
    const item = copiedData(value[key], path);
    if (item !== undefined) copy[key] = item;
  }
  return copy;
}

function checkedValues(raw: unknown): Record<string, FieldValue> {
  let values: FieldValue | undefined;
  try {
    values = isObject(raw) && !Array.isArray(raw) ? copiedData(raw, []) : undefined;
  } catch (error) {
    if (!(error instanceof NotData)) throw error;
  }
  if (values === undefined || values === null || typeof values !== 'object' || Array.isArray(values)) throw new Error(t('importers.invalid.values'));
  const clean = importableValues(values);
  if (JSON.stringify(clean).length > MAX_VALUES_LENGTH) throw new Error(t('importers.invalid.valuesBig'));
  return clean;
}

const isArrayBuffer = (value: unknown): value is ArrayBuffer => Object.prototype.toString.call(value) === '[object ArrayBuffer]';

/** The character an importer gave as Atlas may use it; throws an `Error` whose message says what is wrong. */
export function validatedCharacter(raw: unknown): ImportedCharacter {
  if (!isObject(raw)) throw new Error(t('importers.invalid.character'));
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '') throw new Error(t('importers.invalid.name'));
  if (name.length > MAX_NAME_LENGTH) throw new Error(t('importers.invalid.nameLong'));
  const templateId = typeof raw.templateId === 'string' ? raw.templateId.trim() : '';
  if (templateId === '') throw new Error(t('importers.invalid.template'));
  const values = checkedValues(raw.values);
  const bytes = isObject(raw.portrait) ? raw.portrait.bytes : undefined;
  return { name, templateId, values, ...(isArrayBuffer(bytes) && { portrait: { bytes } }) };
}
