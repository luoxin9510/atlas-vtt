import type { SharedRoll } from '../protocol/index.ts';
import type { ReactElement } from 'react';
import { contestSideName } from '../../dice/contestLine';
import type { ContestSide } from '../../dice/contestTypes';
import { CheckLine, ContestLine } from '../../react/components/dice/RollVerdict';
import { formulaLine } from './rollDice.tsx';

/** One side of a contest: who it is, its roll as `formula = total`, and its check line. */
function Side({ roll, side }: { readonly roll: SharedRoll; readonly side: ContestSide }): ReactElement {
  return (
    <div className="atlas-online-log__contest-side">
      <span className="atlas-online-log__roll-ability atlas-dice-toast__ability">{contestSideName({}, side)}</span>
      <div className="atlas-online-log__roll-summary">
        <span className="atlas-online-log__roll-formula">{formulaLine(roll)}</span>
        <span className="atlas-online-log__roll-equals" aria-hidden="true">=</span>
        <span className="atlas-online-log__roll-total">{roll.total}</span>
      </div>
      <CheckLine result={roll} className="atlas-online-log__roll-check" />
    </div>
  );
}

/** The two rolls of a contest, each with its check line, and the verdict that is on the second. */
export function ContestSummary({ first, second }: { readonly first: SharedRoll; readonly second: SharedRoll }): ReactElement {
  return (
    <>
      <Side roll={first} side="first" />
      <Side roll={second} side="second" />
      {second.contest && <ContestLine contest={second.contest} />}
    </>
  );
}
