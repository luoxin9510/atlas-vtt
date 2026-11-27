/**
 * The contest a check link started and that waits for its second side: the next check link
 * clicked, anywhere (another statblock card, a pane, a note), is it. At most one waits at a time,
 * for the whole app. Escape, a click on anything that is no check link, the card it started on
 * going away, or the plugin unloading cancels it; a hint shows while it waits.
 */

import type { App } from 'obsidian';
import { t } from '../i18n';
import { showNotice } from '../ui/notice';
import { rollStatblockContest, type ContestSide } from './statblockRolls';

interface Pending {
  app: App;
  side: ContestSide;
  link: HTMLElement;
  /** What started it: its going away cancels it. */
  owner: object;
  stop: () => void;
}

let pending: Pending | null = null;

/** Ends the waiting contest, if any: no listener or hint is left. */
export function cancelPendingContest(owner?: object): void {
  if (!pending || (owner !== undefined && pending.owner !== owner)) return;
  const { stop } = pending;
  pending = null;
  stop();
}

/**
 * Starts a contest from `link`, whose check is `side`, replacing one that waits. The click that
 * chose it is no answer: the listeners are put up a tick later.
 */
export function startPendingContest(app: App, side: ContestSide, link: HTMLElement, owner: object): void {
  cancelPendingContest();
  const doc = link.ownerDocument;
  const win = doc.defaultView ?? window;
  const notice = showNotice(t('dice.contest.waiting'), 0);
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') cancelPendingContest();
  };
  // A click on a check link never gets this far: its card takes it (`answerPendingContest`).
  const onClick = (): void => cancelPendingContest();
  const timer = win.setTimeout(() => {
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('click', onClick);
  }, 0);
  pending = {
    app, side, link, owner,
    stop: () => {
      win.clearTimeout(timer);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('click', onClick);
      notice.hide();
    },
  };
}

/**
 * Answers a waiting contest with a link that was activated: a check other than the one it started
 * from (`isCheck`) is the second side and rolls it, `second` read as it is rolled; any other link,
 * the same one included, cancels it, rolling nothing. False where no contest waits.
 */
export function answerPendingContest(link: HTMLElement, isCheck: boolean, second: () => ContestSide): boolean {
  const waiting = pending;
  if (!waiting) return false;
  cancelPendingContest();
  if (isCheck && waiting.link !== link) rollStatblockContest(waiting.app, waiting.side, second());
  return true;
}
