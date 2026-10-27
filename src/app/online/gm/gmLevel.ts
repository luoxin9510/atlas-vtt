import type { App } from 'obsidian';
import { GM_LEVEL, isRecord, readLevel } from '../protocol/index.ts';
import { relayOrigin } from './servers.ts';
import { t } from '../../i18n';

/** Device-local: the least GM level the relay last asked for, which relay said so, and when. */
const MIN_LEVEL_KEY = 'atlas-vtt:online-min-level';
/**
 * How long a refusal holds Start back. Past it Start shows again and the relay answers anew, so a
 * relay rolled back to a lower minimum lets the GM in. ponytail: an hour, at most one refused
 * press an hour while the relay still needs more; a check of its own if that ever bothers anyone.
 */
const REMEMBER_MS = 60 * 60 * 1000;

export const OUTDATED_TEXT = t('onlineGm.outdated');
export const UPDATE_AFTER_TEXT = t('onlineGm.updateAfter');

/** Keeps what the relay last said it needs, from a welcome, a refused table or a refused hello. */
export function rememberMinLevel(app: App, level: number): void {
  const origin = relayOrigin();
  if (origin !== null) app.saveLocalStorage(MIN_LEVEL_KEY, { origin, level, at: Date.now() });
}

/** What this build's relay asked for within the last hour; another relay's word (a staging build's) counts for nothing. */
export function knownMinLevel(app: App): number {
  const origin = relayOrigin();
  const saved: unknown = app.loadLocalStorage(MIN_LEVEL_KEY);
  if (origin === null || !isRecord(saved) || saved.origin !== origin || typeof saved.at !== 'number') return 0;
  return Date.now() - saved.at > REMEMBER_MS ? 0 : readLevel(saved.level);
}

/** Whether the relay asked for more than this Atlas serves; an updated Atlas reads false at once. */
export function isOutdated(app: App): boolean {
  return knownMinLevel(app) > GM_LEVEL;
}
