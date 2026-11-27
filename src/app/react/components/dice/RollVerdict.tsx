import React from 'react';
import { EyeOff } from 'lucide-react';
import { cn } from '../../../../utils/cn';
import { checkLine } from '../../../dice/checkLine';
import type { DiceRollResult } from '../../../types/diceTypes';
import { t } from '../../../i18n';

/** The check's verdict under a total ("Success by 3"); nothing for a roll that was no check. */
export function CheckLine({ result, className }: { result: Pick<DiceRollResult, 'check'>; className?: string }): React.ReactElement | null {
  const line = checkLine(result);
  if (line === null || result.check === undefined) return null;
  const { crit, success } = result.check;
  return (
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
