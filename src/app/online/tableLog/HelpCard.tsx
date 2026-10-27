import { X } from 'lucide-react';
import type { ReactElement } from 'react';
import { LabelTooltip } from '../../packages/components/primitives/tooltip';
import { COMMANDS } from './commandList.ts';
import { t } from '../../i18n';

/** The dice notation, by example, as Foundry VTT writes it. */
const NOTATION: readonly (readonly [string, string])[] = [
  ['2d20kh1', t('onlineLog.help.advantage')],
  ['4d6kh3', t('onlineLog.help.keepThree')],
  ['r1, ro<2, rr1', t('onlineLog.help.reroll')],
  ['x, xo, x>=9', t('onlineLog.help.explode')],
  ['!, !3, !i', t('onlineLog.help.explodeShort')],
  ['cs>=5, >=5', t('onlineLog.help.successes')],
  ['cf<=1', t('onlineLog.help.failures')],
  ['d%, dF', t('onlineLog.help.percentile')],
  ['2d6[fire]', t('onlineLog.help.name')],
  ['+ - * / ( )', t('onlineLog.help.arithmetic')],
  ['[[1d20+5]]', t('onlineLog.help.inline')],
  ['[[/r 1d20+2]]{Dex save}', t('onlineLog.help.inlineButton')],
  ['/r 1d20 # Attack', t('onlineLog.help.describe')],
];

const spellings = (name: string, aliases: readonly string[]): string => [name, ...aliases].map((word) => `/${word}`).join(' ');

/** The commands and the dice notation, in the panel above the message field. */
export function HelpCard({ onClose }: { readonly onClose: () => void }): ReactElement {
  return (
    <div className="atlas-online-log__help" role="region" aria-label={t('onlineLog.help.label')}>
      <div className="atlas-online-log__help-head">
        <span className="atlas-online-log__help-title">{t('onlineLog.help.commands')}</span>
        <LabelTooltip label={t('onlineLog.help.close')}>
          <button type="button" className="atlas-online-log__strip-clear" onClick={onClose}><X /></button>
        </LabelTooltip>
      </div>
      <dl className="atlas-online-log__help-list">
        {COMMANDS.map((command) => (
          <div key={command.name} className="atlas-online-log__help-row">
            <dt className="atlas-online-log__help-term">{spellings(command.name, command.aliases)}</dt>
            <dd className="atlas-online-log__help-text">{command.description}</dd>
          </div>
        ))}
      </dl>
      <span className="atlas-online-log__help-title">{t('onlineLog.help.dice')}</span>
      <dl className="atlas-online-log__help-list">
        {NOTATION.map(([term, text]) => (
          <div key={term} className="atlas-online-log__help-row">
            <dt className="atlas-online-log__help-term">{term}</dt>
            <dd className="atlas-online-log__help-text">{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
