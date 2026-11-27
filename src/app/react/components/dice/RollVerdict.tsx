import React from 'react';
import { EyeOff } from 'lucide-react';
import { cn } from '../../../../utils/cn';
import { checkLine, targetLine } from '../../../dice/checkLine';
import { contestLine } from '../../../dice/contestLine';
import type { RollContest } from '../../../dice/contestTypes';
import type { DiceRollResult } from '../../../types/diceTypes';
import { t } from '../../../i18n';

/**
 * The check's verdict under a total ("Success by 3"), and under it how a moved target was built
 * ("Target 15 → 17 (Agility +2)", unless `withTarget` is false); nothing for a roll that was no check.
 */
export function CheckLine({ result, className, withTarget = true }: { result: Pick<DiceRollResult, 'check'>; className?: string; withTarget?: boolean }): React.ReactElement | null {
  const line = checkLine(result);
  if (line === null || result.check === undefined) return null;
  const { crit, success } = result.check;
  const target = withTarget ? targetLine(result) : null;
  return (
    <>
      <span
        className={cn(
          'atlas-check-line',
          success ? 'atlas-check-line--success' : 'atlas-check-line--failure',
          crit !== null && 'atlas-check-line--crit',
          className,
        )}
      >
        {line}
      </span>
      {target !== null && <span className={cn('atlas-target-line', className && `${className}--target`)}>{target}</span>}
    </>
  );
}

/** Marks a roll only the GM sees (`hidden`), on the GM's own screen; nothing for any other roll. */
export function GmOnlyBadge({ result, className }: { result: Pick<DiceRollResult, 'hidden'>; className?: string }): React.ReactElement | null {
  if (result.hidden !== true) return null;
  return (
    <span className={cn('atlas-gm-only-badge', className)}>
      <EyeOff aria-hidden="true" />
      {t('dice.gmOnlyRolls')}
    </span>
  );
}

/** The verdict of a contest ("Ana wins", "Tie"); nothing for a roll that carries none. */
export function ContestLine({ contest, className }: { contest: RollContest; className?: string }): React.ReactElement | null {
  const line = contestLine(contest);
  if (line === null) return null;
  return <div className={cn('atlas-contest-verdict', contest.verdict?.winner === null && 'atlas-contest-verdict--tie', className)}>{line}</div>;
}
