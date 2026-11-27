import React, { useContext } from 'react';
import { diceLinkProps } from '../../../services/statblockDiceLinks';
import { bonusLink, type RollSwitch } from '../../values/valueRolls';
import { SheetContext } from '../sheetContext';

interface BonusLinkProps {
  /** The text the value shows. */
  text: string;
  /** How its block rolls a whole number: as a bonus ("Roll as a bonus") or as a check ("Roll as a check"). */
  rollable: RollSwitch;
  children: React.ReactNode;
}

/**
 * A value's drawing, made a roll link where its block is rollable and it shows
 * a whole number its text does not link itself (`2` rolls `+2`), or, in a check block, a leading number (`15` rolls `3d6 vs 15`); as it is otherwise.
 */
export function BonusLink({ text, rollable, children }: BonusLinkProps): React.JSX.Element {
  // Dice written without faces count where the statblock's set opts in
  const bonus = bonusLink(text, rollable, useContext(SheetContext)?.state.rollParse);
  return bonus === null ? <>{children}</> : <span {...diceLinkProps(bonus)}>{children}</span>;
}
