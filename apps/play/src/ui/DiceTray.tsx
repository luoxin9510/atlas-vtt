import { useState, useSyncExternalStore, type ReactElement } from 'react';
import { t, type MessageKey } from '../../../../src/app/i18n/index.ts';
import type { RollMode } from '../../../../src/app/online/protocol/index.ts';
import type { RollRefusal } from '../../../../src/app/online/protocol/dice.ts';
import type { LogState } from '../../../../src/app/online/tableLog/index.ts';
import { addDie, addModifier, DICE_FACES, EMPTY_DRAFT, formulaOf, type DiceDraft } from './diceFormula.ts';

const MODES: readonly { mode: RollMode; label: MessageKey }[] = [
  { mode: 'public', label: 'onlinePlay.dice.mode.public' },
  { mode: 'gm', label: 'onlinePlay.dice.mode.gm' },
  { mode: 'blind', label: 'onlinePlay.dice.mode.blind' },
  { mode: 'self', label: 'onlinePlay.dice.mode.self' },
];

const REFUSALS: Readonly<Record<RollRefusal, MessageKey>> = {
  formula: 'onlinePlay.dice.refused.formula',
  rate: 'onlinePlay.dice.refused.rate',
  scene: 'onlinePlay.dice.refused.scene',
  unavailable: 'onlinePlay.dice.refused.unavailable',
};

export interface DiceTrayProps {
  log: LogState;
  /** Whether a roll can be sent now (connected, a scene shown). */
  canRoll: boolean;
  refusal: RollRefusal | null;
  onRoll(formula: string, mode: RollMode): void;
  onClearRefusal(): void;
}

/** Dice chips, a modifier, the formula they make and the roll mode (kept in the log's composer choices). */
export function DiceTray({ log, canRoll, refusal, onRoll, onClearRefusal }: DiceTrayProps): ReactElement {
  const [draft, setDraft] = useState<DiceDraft>(EMPTY_DRAFT);
  const { rollMode } = useSyncExternalStore(log.subscribe, log.choices);
  const formula = formulaOf(draft);
  const change = (next: DiceDraft): void => {
    setDraft(next);
    if (refusal !== null) onClearRefusal();
  };
  return (
    <div className="atlas-play-dice">
      <div className="atlas-play-dice-chips">
        {DICE_FACES.map((faces) => (
          <button key={faces} type="button" aria-label={t('onlinePlay.dice.add', { faces })} onClick={() => change(addDie(draft, faces))}>
            d{faces}{draft.dice[faces] > 0 ? <span className="atlas-play-count">{draft.dice[faces]}</span> : null}
          </button>
        ))}
      </div>
      <div className="atlas-play-dice-modifier">
        <button type="button" aria-label={t('onlinePlay.dice.minus')} onClick={() => change(addModifier(draft, -1))}>−</button>
        <output aria-label={t('onlinePlay.dice.modifier')}>{draft.modifier > 0 ? `+${draft.modifier}` : String(draft.modifier)}</output>
        <button type="button" aria-label={t('onlinePlay.dice.plus')} onClick={() => change(addModifier(draft, 1))}>+</button>
      </div>
      <output className="atlas-play-dice-formula" aria-label={t('onlinePlay.dice.formula')}>{formula ?? t('onlinePlay.dice.empty')}</output>
      <div className="atlas-play-modes" role="radiogroup" aria-label={t('onlinePlay.dice.mode.label')}>
        {MODES.map(({ mode, label }) => (
          <button key={mode} type="button" role="radio" aria-checked={rollMode === mode} onClick={() => log.setRollMode(mode)}>{t(label)}</button>
        ))}
      </div>
      {refusal !== null ? <p className="atlas-play-reason" role="alert">{t(REFUSALS[refusal])}</p> : null}
      <div className="atlas-play-dice-actions">
        <button type="button" className="atlas-play-primary" disabled={formula === null || !canRoll} onClick={() => formula !== null && onRoll(formula, rollMode)}>
          {t('onlinePlay.dice.roll')}
        </button>
        <button type="button" onClick={() => change(EMPTY_DRAFT)}>{t('onlinePlay.dice.clear')}</button>
      </div>
    </div>
  );
}
