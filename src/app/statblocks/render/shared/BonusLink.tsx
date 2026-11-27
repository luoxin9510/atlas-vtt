import React, { useContext } from 'react';
import { diceLinkProps } from '../../../services/statblockDiceLinks';
import { bonusLink } from '../../values/valueRolls';
import { SheetContext } from '../sheetContext';

interface BonusLinkProps {
  /** The text the value shows. */
  text: string;
  /** Whether its block rolls a whole number as a bonus ("Roll as a bonus"). */
  rollable: boolean | undefined;
  children: React.ReactNode;
}

/**
 * A value's drawing, made a roll link where its block is rollable and it shows
 * a whole number its text does not link itself (`2` rolls `+2`); as it is otherwise.
 */
export function BonusLink({ text, rollable, children }: BonusLinkProps): React.JSX.Element {
  // Dice written without faces count where the statblock's set opts in
  const bonus = bonusLink(text, rollable, useContext(SheetContext)?.state.rollParse);
  return bonus === null ? <>{children}</> : <span {...diceLinkProps(bonus)}>{children}</span>;
}
