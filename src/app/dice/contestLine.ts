import { t } from '../i18n';
import type { ContestSide, RollContest } from './contestTypes';

/** What a side is called: the name the contest carries, else "First side" / "Second side". */
export function contestSideName(contest: Pick<RollContest, 'names'>, side: ContestSide): string {
  return contest.names?.[side] || t(side === 'first' ? 'dice.contest.first' : 'dice.contest.second');
}

/**
 * The verdict of a contest as one line ("Ana wins", "Tie"), or null where the roll carries none (the
 * first side, which the verdict is not on). The one formatter the 3D panel, the card and the logs share.
 */
export function contestLine(contest: Pick<RollContest, 'names' | 'verdict'>): string | null {
  const { verdict } = contest;
  if (verdict === undefined) return null;
  return verdict.winner === null ? t('dice.contest.tie') : t('dice.contest.wins', { name: contestSideName(contest, verdict.winner) });
}
