import React, { useState } from 'react';
import { t } from '../../../i18n';

export interface DiceFormulaInputProps {
  /** The message that refuses the text, or null where it can be rolled. */
  validate: (text: string) => string | null;
  /** Rolls the text; false where nothing rolled, and the dropdown stays open. */
  onRoll: (text: string) => boolean;
  onClose: () => void;
}

/**
 * The dice dropdown's free-text input: a formula or a check (`3d6 vs 14`). Enter rolls it, Escape
 * closes the dropdown; text the parser refuses shows its message under the field and rolls nothing.
 */
export function DiceFormulaInput({ validate, onRoll, onClose }: DiceFormulaInputProps): React.ReactElement {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const written = text.trim();
    if (written === '') return;
    const refusal = validate(written);
    setError(refusal);
    if (refusal === null) onRoll(written);
  };

  return (
    <div className="atlas-dice-tray__formula-input">
      <input
        type="text"
        className="atlas-dice-tray__formula-field"
        value={text}
        placeholder={t('dice.formulaInput.placeholder')}
        aria-label={t('dice.formulaInput.label')}
        aria-invalid={error !== null}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          // The map's hotkeys stay out of what is typed here.
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      {error !== null && <p className="atlas-dice-tray__formula-error" role="alert">{error}</p>}
    </div>
  );
}
