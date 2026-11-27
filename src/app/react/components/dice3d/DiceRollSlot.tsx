import React from 'react';
import { motion } from 'framer-motion';
import type { DiceScene } from '../../../dice3d/diceScene';
import type { DiceRollResult } from '../../../types/diceTypes';
import { targetLine } from '../../../dice/checkLine';
import { CheckLine } from '../dice/RollVerdict';
import { hasBreakdown, rollBreakdown } from './diceRollText';

interface DiceRollSlotProps {
  result: DiceRollResult;
  scene: DiceScene;
  /** The counter's number once the dice lie, else null (the formula shows). */
  shown: number | null;
  formula: string;
  /** Modifier steps clicked in so far; a new count makes the counter jump. */
  appliedSteps: number;
  reduced: boolean;
}

/**
 * The full-size panel's result place: the formula while the dice fly, then the
 * counted total, its breakdown and the check's lines. Its height holds room
 * for every line the roll will show, so the panel never grows when they arrive.
 */
export function DiceRollSlot({ result, scene, shown, formula, appliedSteps, reduced }: DiceRollSlotProps): React.ReactElement {
  const breakdown = rollBreakdown(result, scene);
  const slotRem = 3.2 + (hasBreakdown(result, scene) ? 1.05 : 0) + (result.check ? 1.05 : 0) + (targetLine(result) !== null ? 1.05 : 0);
  return (
    <div className="atlas-dice-roll__slot" style={{ height: `${slotRem}rem` }}>
      {shown !== null ? (
        <>
          <motion.span
            className="atlas-dice-roll__total"
            initial={reduced ? false : { opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reduced ? { duration: 0.12 } : { type: 'spring', duration: 0.55, bounce: 0.3 }}
          >
            {/* Every step its own key: the counter jumps, it does not cross-fade. */}
            <motion.span
              key={shown}
              className="atlas-dice-roll__count"
              initial={reduced || appliedSteps === 0 ? false : { scale: 1.22 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', duration: 0.34, bounce: 0.42 }}
            >
              {shown}
            </motion.span>
          </motion.span>
          {breakdown !== null && (
            <motion.span
              className="atlas-dice-roll__breakdown"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: reduced ? 0 : 0.12 }}
            >
              {breakdown}
            </motion.span>
          )}
          <CheckLine result={result} />
        </>
      ) : (
        <motion.span
          className="atlas-dice-roll__formula"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.16 }}
        >
          {formula}
        </motion.span>
      )}
    </div>
  );
}
