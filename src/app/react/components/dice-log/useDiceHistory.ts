import type { EventEmitter } from 'events';
import { useState, useEffect, useCallback } from 'react';
import type { DiceRollResult } from '../../../types/diceTypes';
import type { DiceRollOrigin } from '../../../types/diceRollOrigin';
import type { ContestOptions, RollOptions } from '../../../tools/DiceTool';

type RollDice = (formula: string, source?: DiceRollResult['source'], origin?: DiceRollOrigin, options?: RollOptions) => DiceRollResult | null;

type RollContest = (first: string, second: string, options?: ContestOptions) => [DiceRollResult, DiceRollResult] | null;

const MAX_HISTORY = 20;

/**
 * Subscribes to dice roll events and provides a reactive history array.
 * Seeds from the store's persisted `diceLog` on mount, syncs new rolls
 * back to the store for persistence across map close/reopen.
 */
export function useDiceHistory(
  getDiceTool: () => { rollDice: RollDice; rollContest?: RollContest; clearHistory: () => void } | null,
  storeActions?: {
    diceLog: DiceRollResult[];
    addDiceLogEntry: (entry: DiceRollResult) => void;
    clearDiceLog: () => void;
  },
  eventBus?: EventEmitter,
): {
  history: DiceRollResult[];
  clearHistory: () => void;
  /** Rolls a logged roll again, with the side of advantage it was rolled with. */
  /** Rolls it again; a GM-only roll (`hidden`) is repeated GM-only. */
  repeatRoll: (formula: string, source?: DiceRollResult['source'], advantage?: DiceRollResult['advantage'], hidden?: boolean) => void;
  /** Rolls a logged contest again as a new pair, with its names, its side of advantage, and GM-only where it was. */
  repeatContest: (first: DiceRollResult, second: DiceRollResult) => void;
} {
  const [history, setHistory] = useState<DiceRollResult[]>(() =>
    storeActions?.diceLog ?? [],
  );

  // Re-seed when store's diceLog changes (e.g. map switch / hydration)
  useEffect(() => {
    if (storeActions?.diceLog) {
      setHistory(storeActions.diceLog);
    }
  }, [storeActions?.diceLog]);

  // Listen only to the view that owns this history.
  useEffect(() => {
    const handleRoll = (result: DiceRollResult): void => {
      setHistory(prev => {
        const next = [result, ...prev];
        return next.length > MAX_HISTORY ? next.slice(0, MAX_HISTORY) : next;
      });
      // Persist to store so it survives map close/reopen
      storeActions?.addDiceLogEntry(result);
    };

    const handleClear = (): void => {
      setHistory([]);
      storeActions?.clearDiceLog();
    };

    eventBus?.on('dice-rolled', handleRoll);
    eventBus?.on('dice-history-cleared', handleClear);
    return () => {
      eventBus?.off('dice-rolled', handleRoll);
      eventBus?.off('dice-history-cleared', handleClear);
    };
  }, [storeActions, eventBus]);

  const clearHistory = useCallback((): void => {
    getDiceTool()?.clearHistory();
  }, [getDiceTool]);

  const repeatRoll = useCallback((formula: string, source?: DiceRollResult['source'], advantage?: DiceRollResult['advantage'], hidden?: boolean): void => {
    const diceTool = getDiceTool();
    if (!diceTool) return;
    if (advantage || hidden) diceTool.rollDice(formula, source, undefined, { ...(advantage && { advantage }), ...(hidden && { visibility: 'gm' as const }) });
    else diceTool.rollDice(formula, source);
  }, [getDiceTool]);

  const repeatContest = useCallback((first: DiceRollResult, second: DiceRollResult): void => {
    // Only the sides' formulas and advantage are repeated: the check text carries each target, so the verdict
    // is right, but how a target was moved (`check.targetSteps`) is not recorded again.
    getDiceTool()?.rollContest?.(first.formula, second.formula, {
      names: first.contest?.names,
      sideAdvantage: { first: first.advantage, second: second.advantage },
      ...(first.hidden && { visibility: 'gm' as const }),
    });
  }, [getDiceTool]);

  return { history, clearHistory, repeatRoll, repeatContest };
}
