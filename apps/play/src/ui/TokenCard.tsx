import type { ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';
import { barFill, conditionText } from '../scene/tokenSprite.ts';

export interface TokenCardProps {
  token: SharedToken;
  onClose(): void;
}

/** What a player sees of a token of theirs: its name, its resources as numbers and its conditions. */
export function TokenCard({ token, onClose }: TokenCardProps): ReactElement {
  const ui = token.ui;
  return (
    <section className="atlas-play-token-card" role="dialog" aria-label={token.name ?? t('onlinePlay.token.unnamed')}>
      <header>
        <h2>{token.name ?? t('onlinePlay.token.unnamed')}</h2>
        <button type="button" onClick={onClose} aria-label={t('onlinePlay.token.close')}>×</button>
      </header>
      {ui?.downed ? <p className="atlas-play-token-downed">{t('onlinePlay.token.downed')}</p> : null}
      {ui && ui.bars.length > 0 ? (
        <ul className="atlas-play-token-bars" aria-label={t('onlinePlay.token.bars')}>
          {ui.bars.map((bar, i) => (
            <li key={i}>
              <span className="atlas-play-swatch" style={{ background: bar.colour }} />
              <span>{bar.direction === 'static' ? bar.max : `${bar.current} / ${bar.max}`}</span>
              <span className="atlas-play-meter"><span style={{ background: bar.colour, width: `${Math.round(barFill(bar) * 100)}%` }} /></span>
            </li>
          ))}
        </ul>
      ) : null}
      <h3>{t('onlinePlay.token.conditions')}</h3>
      {ui && ui.conditions.length > 0 ? (
        <ul className="atlas-play-token-conditions">
          {ui.conditions.map((condition, i) => (
            <li key={i}>
              <span className="atlas-play-badge" style={{ background: condition.colour }}>{conditionText(condition)}</span>
              {condition.value !== null ? <span>{condition.value}</span> : null}
            </li>
          ))}
        </ul>
      ) : <p>{t('onlinePlay.token.noConditions')}</p>}
    </section>
  );
}
