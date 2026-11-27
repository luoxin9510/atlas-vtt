/**
 * Who sees a roll the GM makes: the one place that decides. A roll that names its visibility keeps it
 * (`'all'` forces a public roll, e.g. a rule pack's); one that names none follows the GM-only switch
 * (setting `rollsGmOnly`), so while it is on every roll the GM makes is GM-only, whichever surface rolled it.
 * Rolls made by players online are not the GM's: their callers name `'all'`.
 */

/** What a roll may say about who sees it. */
export type RollVisibility = 'all' | 'gm';

/** Whether a roll naming `visibility` is GM-only, given the GM's switch (`gmOnly`; unset: no switch, off). */
export function isGmOnlyRoll(visibility: RollVisibility | undefined, gmOnly: (() => boolean) | undefined): boolean {
  return visibility === undefined ? gmOnly?.() === true : visibility === 'gm';
}

/** Marks `result` hidden where a roll naming `visibility` is GM-only; returns it. */
export function hideGmOnly<T extends { hidden?: true }>(result: T, visibility: RollVisibility | undefined, gmOnly: (() => boolean) | undefined): T {
  if (isGmOnlyRoll(visibility, gmOnly)) result.hidden = true;
  return result;
}
