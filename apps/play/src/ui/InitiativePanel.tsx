import { Fragment, type ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';
import type { SharedCombatant, SharedInitiative } from '../../../../src/app/online/protocol/initiative.ts';
import { useAssetUrl, type Loader } from '../assets/useAssetUrl.ts';
import { TokenPortrait } from '../../../../src/app/packages/components/shared/TokenPortrait.tsx';

/** Longest side of the art asked for (the same as the map's tokens). */
export const ART_SIDE = 512;

function Combatant({ combatant, assets }: { combatant: SharedCombatant; assets: Loader }): ReactElement {
  const src = useAssetUrl(assets, combatant.art, ART_SIDE);
  const name = combatant.name ?? t('onlinePlay.initiative.unknown');
  const classes = ['atlas-play-combatant', combatant.turn && 'atlas-play-turn', combatant.defeated && 'atlas-play-defeated', combatant.sitsOut && 'atlas-play-dim'];
  return (
    <li className={classes.filter(Boolean).join(' ')} aria-current={combatant.turn ? 'true' : undefined}>
      <TokenPortrait src={src ?? ''} pending={src === null} alt="" showRing={combatant.ring !== null} ringColor={combatant.ring?.colour ?? undefined} className="atlas-play-portrait" />
      <span className="atlas-play-name">{name}</span>
      {combatant.hp !== null ? <small>{combatant.hp.current}/{combatant.hp.max}</small> : null}
      <span className="atlas-play-number">{combatant.unnumbered ? '–' : combatant.initiative}</span>
    </li>
  );
}

function sideName(list: SharedInitiative, combatant: SharedCombatant): string {
  const id = combatant.sideId ?? combatant.side;
  const named = list.sides?.find((side) => side.id === id);
  return named?.name ?? t(combatant.side === 'players' ? 'onlinePlay.initiative.players' : 'onlinePlay.initiative.opponents');
}

export interface InitiativePanelProps {
  initiative: SharedInitiative | null;
  assets: Loader;
}

/** The round and the combatants in the GM's order; the turn highlighted, defeated ones struck through, heads per side when the fight is by sides. */
export function InitiativePanel({ initiative, assets }: InitiativePanelProps): ReactElement {
  if (initiative === null || initiative.combatants.length === 0) return <p className="atlas-play-empty">{t('onlinePlay.initiative.empty')}</p>;
  let lastSide: string | null = null;
  return (
    <div className="atlas-play-initiative">
      <h3>{t('onlinePlay.initiative.round', { round: initiative.round })}</h3>
      <ol>
        {initiative.combatants.map((combatant, index) => {
          const side = initiative.bySides ? combatant.sideId ?? combatant.side : null;
          const head = side !== null && side !== lastSide;
          lastSide = side;
          return (
            <Fragment key={index}>
              {head ? <li className="atlas-play-side" role="presentation">{sideName(initiative, combatant)}</li> : null}
              <Combatant combatant={combatant} assets={assets} />
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
