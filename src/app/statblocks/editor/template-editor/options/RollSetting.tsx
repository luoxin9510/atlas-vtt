import React from 'react';
import { t } from '../../../../i18n';
import { type MetricBlock, type PairsBlock, type ScoresBlock, type StatBlock, type TemplateBlock } from '../../../model/templateTypes';
import { rollModeOf } from '../../../values/rollMode';
import { editBlock } from '../inspector/blockEdits';
import { SwitchSetting } from '../inspector/InspectorControls';
import type { EditorSession } from '../sessionTypes';

/** The blocks whose whole numbers may roll as a bonus. */
type RollableBlock = StatBlock | MetricBlock | ScoresBlock | PairsBlock;

function isRollableBlock(block: TemplateBlock): block is RollableBlock {
  return block.type === 'stat' || block.type === 'metric' || block.type === 'scores' || block.type === 'pairs';
}

interface RollSettingProps {
  block: TemplateBlock;
  session: EditorSession;
  readOnly: boolean;
}

/**
 * "Roll as a bonus": every whole number the tile shows becomes a roll link, `2` rolling `+2` with the
 * game's own dice. "Roll as a check": the leading number of a value is the target of the set's roll, `15`
 * rolling `3d6 vs 15`. The two are one choice, so either takes the other's place; one step; off removes
 * the key, so a template that never used them keeps its file.
 */
export function RollSetting({ block, session, readOnly }: RollSettingProps): React.JSX.Element | null {
  if (!isRollableBlock(block)) return null;
  const mode = rollModeOf(block);
  return (
    <>
      <SwitchSetting label={t('statblock.rollAsBonus')} value={mode === 'bonus'} disabled={readOnly}
        onChange={(on) => editBlock(session, block.id, block.type, { rollable: on ? true : undefined, rollAs: undefined })} />
      <SwitchSetting label={t('statblock.rollAsCheck')} value={mode === 'check'} disabled={readOnly}
        onChange={(on) => editBlock(session, block.id, block.type, { rollAs: on ? 'check' : undefined, rollable: undefined })} />
    </>
  );
}
