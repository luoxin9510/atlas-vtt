/**
 * What a re-import would change (P3c decisions 28, 29): the imported keys of a note compared with
 * the values the file gives now. Pure; only keys the import wrote (the record's) or writes (the
 * new values') are looked at, so what the person added to the note is never part of it.
 */

import { formatList, t } from '../i18n';
import type { FieldValue } from '../statblocks/model/templateTypes';

export type ChangeDetail =
  | { type: 'scalar'; from?: string; to?: string }
  | { type: 'list'; added: string[]; removed: string[]; changed: string[] }
  | { type: 'object' };

export interface ImportChange {
  key: string;
  kind: 'changed' | 'added' | 'removed';
  detail: ChangeDetail;
}

const SHORT_LENGTH = 40;

const isList = (value: unknown): value is FieldValue[] => Array.isArray(value);
const isMap = (value: unknown): value is { [key: string]: FieldValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value in a line of text: scalars as they are (cut at `SHORT_LENGTH`), anything bigger as `…`. */
function shortText(value: FieldValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return '…';
  const text = String(value);
  return text.length > SHORT_LENGTH ? `${text.slice(0, SHORT_LENGTH - 1)}…` : text;
}

/** The same value whatever the order of a map's keys. */
function canonical(value: FieldValue | undefined): string {
  if (value === undefined) return 'u';
  if (isList(value)) return `[${value.map(canonical).join(',')}]`;
  if (isMap(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** An item of a list by its name: the `name` of an entry, else its first text, else the item itself. */
function itemName(item: FieldValue): string {
  if (isMap(item)) {
    if (typeof item.name === 'string' && item.name !== '') return item.name;
    const first = Object.values(item).find((value): value is string => typeof value === 'string' && value !== '');
    return first ?? '…';
  }
  return shortText(item);
}

/** `Name old → new` when two entries differ in one scalar only, else the name alone. */
function changedItemText(name: string, before: FieldValue, after: FieldValue): string {
  const unclear = t('importers.diff.itemChanged', { name });
  if (!isMap(before) || !isMap(after)) return unclear;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => canonical(before[key]) !== canonical(after[key]));
  const [only] = keys;
  if (keys.length !== 1 || only === undefined) return unclear;
  const [from, to] = [before[only], after[only]];
  const scalar = (value: FieldValue | undefined): boolean => value === undefined || value === null || typeof value !== 'object';
  return scalar(from) && scalar(to) ? `${name} ${shortText(from)} → ${shortText(to)}` : unclear;
}

/** Items grouped by name, each name's items in order, so the n-th "Bite" is told from the first. */
function byName(list: readonly FieldValue[]): Map<string, FieldValue[]> {
  const groups = new Map<string, FieldValue[]>();
  for (const item of list) {
    const name = itemName(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return groups;
}

function listDetail(before: readonly FieldValue[], after: readonly FieldValue[]): ChangeDetail & { type: 'list' } {
  const detail: ChangeDetail & { type: 'list' } = { type: 'list', added: [], removed: [], changed: [] };
  const [old, next] = [byName(before), byName(after)];
  for (const name of new Set([...old.keys(), ...next.keys()])) {
    const [was, now] = [old.get(name) ?? [], next.get(name) ?? []];
    for (let at = 0; at < Math.max(was.length, now.length); at++) {
      const [a, b] = [was[at], now[at]];
      if (a === undefined && b !== undefined) detail.added.push(name);
      else if (b === undefined && a !== undefined) detail.removed.push(name);
      else if (a !== undefined && b !== undefined && canonical(a) !== canonical(b)) detail.changed.push(changedItemText(name, a, b));
    }
  }
  return detail;
}

/** What setting `after` over `before` changes about one key; null when nothing. */
function changeOf(key: string, before: FieldValue | undefined, after: FieldValue | undefined): ImportChange | null {
  if (before === undefined && after === undefined) return null;
  if (before !== undefined && after !== undefined && canonical(before) === canonical(after)) return null;
  const kind = before === undefined ? 'added' : after === undefined ? 'removed' : 'changed';
  const shown = after ?? before;
  if (isList(shown) && (before === undefined || isList(before)) && (after === undefined || isList(after))) {
    return { key, kind, detail: listDetail(before === undefined ? [] : isList(before) ? before : [], after === undefined ? [] : isList(after) ? after : []) };
  }
  if (kind === 'changed' && isMap(before) && isMap(after)) return { key, kind, detail: { type: 'object' } };
  return {
    key,
    kind,
    detail: {
      type: 'scalar',
      ...(before !== undefined && { from: shortText(before) }),
      ...(after !== undefined && { to: shortText(after) }),
    },
  };
}

/** One change as a line of the confirmation: `hp: 10 → 12`, `skills: Broadsword 15 → 16, added Shield`. */
export function changeText({ key, kind, detail }: ImportChange): string {
  if (kind === 'removed') return t('importers.diff.removed', { key });
  if (detail.type === 'object') return t('importers.diff.nested', { key });
  if (detail.type === 'scalar') {
    return kind === 'added' ? t('importers.diff.added', { key, to: detail.to ?? '' }) : t('importers.diff.changed', { key, from: detail.from ?? '', to: detail.to ?? '' });
  }
  if (kind === 'added') return t('importers.diff.addedItems', { key, items: formatList(detail.added) });
  const parts = [
    ...detail.changed,
    ...(detail.added.length > 0 ? [t('importers.diff.itemsAdded', { items: formatList(detail.added) })] : []),
    ...(detail.removed.length > 0 ? [t('importers.diff.itemsRemoved', { items: formatList(detail.removed) })] : []),
  ];
  return t('importers.diff.list', { key, parts: formatList(parts) });
}

/**
 * The changes a re-import makes to the note's frontmatter, in the order of the keys (the record's,
 * then new ones). `recordKeys` are the keys the last import wrote: one the file no longer gives is
 * removed from the note.
 */
export function diffImport(
  frontmatter: Readonly<Record<string, FieldValue | undefined>>,
  imported: Readonly<Record<string, FieldValue>>,
  recordKeys: readonly string[],
): ImportChange[] {
  const keys = [...new Set([...recordKeys, ...Object.keys(imported)])];
  return keys.flatMap((key) => changeOf(key, frontmatter[key], imported[key]) ?? []);
}
