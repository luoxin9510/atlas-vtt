import React, { useEffect, useRef } from 'react';
import { cn } from 'src/utils/cn';
import { useKeepInView } from '../../../packages/components/primitives/useKeepInView';
import { DiceTool, type RollOptions } from '../../../tools/DiceTool';
import { DiceTray, type TrayAdvantage } from './DiceTray';
import { DiceFormulaInput } from './DiceFormulaInput';
import { specOfText } from '../../../tools/buildRoll';
import { completeFormula } from '../../../tools/completeFormula';
import { rollParseOptionsOf } from '../../../gameSystems/diceSets';
import { t } from '../../../i18n';
import type { AdvantageSide } from '../../../types/diceSetTypes';
import { advantageSidesFor, ruledSides } from '../../../tools/diceAdvantage';
import { useAtlasUI } from '../../root/AtlasUIContext';
import { diceFontClass, useDiceLook } from '../../hooks/useDiceLook';
import { useShareRolls } from '../../hooks/useShareRolls';
import { useGmOnlyRolls } from '../../hooks/useGmOnlyRolls';

export interface DiceDropdownMenuProps {
  diceTool: DiceTool;
  isOpen: boolean;
  onToggle: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/** What advantage the collection's dice set offers the tray; undefined where it has no rule. */
function trayAdvantage(diceTool: DiceTool): TrayAdvantage | undefined {
  const rules = diceTool.rollingDice();
  const sides = ruledSides(rules);
  return sides.length > 0 ? { sides, applies: (formula) => advantageSidesFor(formula, rules).length > 0 } : undefined;
}

/** How a tray roll is made besides its formula: its side of advantage and, while the GM-only switch is on, its visibility; none for a plain roll. */
function rollOptions(side: AdvantageSide | null, gmOnly: boolean): RollOptions | undefined {
  if (!side && !gmOnly) return undefined;
  return { ...(side && { advantage: side }), ...(gmOnly && { visibility: 'gm' as const }) };
}

/** The parser's message for text that is no formula or check of the tool's dice, or null where it can be rolled. */
function formulaRefusal(diceTool: DiceTool, text: string): string | null {
  const rules = diceTool.rollingDice();
  const parsed = completeFormula(specOfText(text, rollParseOptionsOf(rules)).formula, rules);
  return parsed.ok ? null : t(`dice.formulaError.${parsed.code}`);
}

export function DiceDropdownMenu({ diceTool, isOpen, onToggle, triggerRef }: DiceDropdownMenuProps): React.ReactElement | null {
  const trayRef = useRef<HTMLDivElement>(null);
  const { app } = useAtlasUI();
  const look = useDiceLook(app ?? undefined);
  const keepInView = useKeepInView(trayRef, isOpen, 'top');
  const shareRolls = useShareRolls();
  const gmOnly = useGmOnlyRolls();
  // Read as the tray opens: it unmounts when closed, so a set changed meanwhile is read anew.
  const advantage = isOpen ? trayAdvantage(diceTool) : undefined;

  // ── Click-outside ────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as HTMLElement;
      if (triggerRef?.current?.contains(target)) return;
      if (target.closest('.atlas-dice-tray')) return;
      onToggle();
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onToggle, triggerRef]);

  // Hangs from its toolbar button inside the map view, like the other toolbar
  // dropdowns: it stays in the view's stacking order, so the DM dashboard and
  // the asset manager cover it. Closed, the tray unmounts and forgets its dice.
  if (!isOpen) return null;
  return (
    <div
      ref={trayRef}
      className={cn('atlas-dice-tray', diceFontClass(look), keepInView.capped && 'atlas-keep-in-view--capped')}
      style={keepInView.style}
    >
      <div className="atlas-dice-panel">
        <DiceFormulaInput
          validate={(text) => formulaRefusal(diceTool, text)}
          onRoll={(text) => {
            const options = rollOptions(null, gmOnly?.on === true);
            const rolled = options ? diceTool.rollDice(text, undefined, undefined, options) : diceTool.rollDice(text);
            if (!rolled) return false;
            onToggle();
            return true;
          }}
          onClose={onToggle}
        />
        <DiceTray
          onRoll={(formula, side) => {
            const options = rollOptions(side, gmOnly?.on === true);
            const rolled = options ? diceTool.rollDice(formula, undefined, undefined, options) : diceTool.rollDice(formula);
            if (!rolled) return false;
            onToggle();
            return true;
          }}
          advantage={advantage}
          {...(shareRolls && { shareRolls })}
          {...(gmOnly && { gmOnly })}
        />
      </div>
    </div>
  );
}
