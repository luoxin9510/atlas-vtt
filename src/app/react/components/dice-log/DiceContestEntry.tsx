import React from 'react';
import { RotateCw } from 'lucide-react';
import { cn } from '../../../../utils/cn';
import type { DiceRollResult } from '../../../types/diceTypes';
import { LabelTooltip } from '../../../packages/components/primitives/tooltip';
import { rollLine } from '../../../tools/diceLabels';
import { contestSideName } from '../../../dice/contestLine';
import type { ContestSide } from '../../../dice/contestTypes';
import { t } from '../../../i18n';
import { CheckLine, ContestLine, GmOnlyBadge } from '../dice/RollVerdict';

interface DiceContestEntryProps {
  first: DiceRollResult;
  second: DiceRollResult;
  isNew?: boolean;
  /** Rolls the whole contest again. */
  onRepeat: () => void;
}

/** One side of the contest: who, its roll as `formula = total`, and its check line. */
function ContestSideRow({ result, side }: { result: DiceRollResult; side: ContestSide }): React.ReactElement {
  return (
    <div className="dice-log-entry__side">
      <span className="dice-log-entry__token-name">{contestSideName(result.contest ?? {}, side)}</span>
      <div className="dice-log-entry__summary">
        <span className="dice-log-entry__formula">{rollLine(result)}</span>
        <span className="dice-log-entry__eq">=</span>
        <span className="dice-log-entry__total">{result.total}</span>
      </div>
      <CheckLine result={result} />
    </div>
  );
}

/**
 * A contest as one entry of the GM's dice log: both rolls, each with its check line, and the verdict
 * (which is on the second roll). Repeating it rolls the contest again as a new pair.
 */
export function DiceContestEntry({ first, second, isNew, onRepeat }: DiceContestEntryProps): React.ReactElement {
  return (
    <div className={cn('dice-log-entry', 'dice-log-entry--contest', isNew && 'dice-log-entry--new')}>
      <div className="dice-log-entry__body">
        <GmOnlyBadge result={first} />
        <ContestSideRow result={first} side="first" />
        <ContestSideRow result={second} side="second" />
        {second.contest && <ContestLine contest={second.contest} />}
        <div className="dice-log-entry__footer">
          <div className="dice-log-entry__callout" />
          <LabelTooltip label={t('dice.rollAgain')}>
            <button className="btn btn--ghost btn--icon dice-log-entry__repeat" onClick={onRepeat}>
              <RotateCw />
            </button>
          </LabelTooltip>
        </div>
      </div>
    </div>
  );
}
