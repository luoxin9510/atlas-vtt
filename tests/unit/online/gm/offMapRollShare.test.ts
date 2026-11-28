import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DICE_RULES } from '../../../../src/app/gameSystems/diceRules';
import type { GmMessage } from '../../../../src/app/online/protocol/index.ts';
import type { DiceRollResult } from '../../../../src/app/types/diceTypes';
import type { DiceSource } from '../../../../src/app/online/gm/atlasDice.ts';
import type { LoggedRoll } from '../../../../src/app/online/gm/log/TableLog.ts';
import { OffMapRollShare } from '../../../../src/app/online/gm/OffMapRollShare.ts';
import type { OffMapRollFeed } from '../../../../src/app/services/offMapRollFeed';
import { RollShare } from '../../../../src/app/online/gm/RollShare.ts';
import { rollEntry } from '../../../../src/app/online/gm/log/logTypes.ts';
import { viewOf } from '../../../../src/app/online/gm/log/logEntries.ts';

const names = { first: 'Ana', second: 'Bo' };
const check = { target: 10, direction: 'over' as const, margin: 2, success: true, crit: null, rule: 'builtin:margin', baseTarget: 8, targetSteps: [{ label: 'Sneak Attack', value: 2 }] };
const roll = (extra: Partial<DiceRollResult> = {}): DiceRollResult => ({
  id: 'roll_1', timestamp: 1, formula: '1d20 + 4', rolls: [{ die: 'd20', value: 13, max: 20 }], modifiers: 4, total: 17, crit: null, player: 'Player',
  source: { type: 'statblock', tokenName: 'Goblin Chief', abilityName: 'Sneak Attack' }, ...extra,
});

/** A roller's bus: what `OffMapRoller.onRoll` is to the share. */
function roller(): OffMapRollFeed & { emit(result: DiceRollResult): void; listeners(): number } {
  const bus = new EventEmitter();
  return {
    onRoll: (listener) => {
      bus.on('roll', listener);
      return () => { bus.off('roll', listener); };
    },
    emit: (result) => void bus.emit('roll', { result, doc: {} as Document, muted: false }),
    listeners: () => bus.listenerCount('roll'),
  };
}

function table(showGmRolls = true): { source: ReturnType<typeof roller>; share: OffMapRollShare; sent: GmMessage[]; logged: Array<Omit<LoggedRoll, 'face'>> } {
  const source = roller();
  const sent: GmMessage[] = [];
  const logged: Array<Omit<LoggedRoll, 'face'>> = [];
  const share = new OffMapRollShare(() => source, { send: (body) => sent.push(body), showGmRolls: () => showGmRolls, logged: (entry) => logged.push(entry) });
  share.start();
  return { source, share, sent, logged };
}

const rolls = (sent: GmMessage[]): Extract<GmMessage, { t: 'roll' }>[] => sent.flatMap((body) => (body.t === 'roll' ? [body] : []));

describe('an off-map roll shared online', () => {
  it('goes to the players as a roll of the GM, without a token and with names stripped', () => {
    const { source, sent, logged } = table();
    source.emit(roll());
    expect(rolls(sent)).toHaveLength(1);
    expect(rolls(sent)[0]).toMatchObject({ t: 'roll', who: 'gm', token: null, result: { total: 17, formula: '1d20 + 4', source: { type: 'statblock' } } });
    expect(JSON.stringify(sent)).not.toMatch(/Goblin Chief|Sneak Attack|Player/);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ who: 'gm', shared: true });
  });

  it('is withheld while the player view shows no GM rolls', () => {
    const { source, sent } = table(false);
    source.emit(roll());
    expect(rolls(sent)).toEqual([]);
  });

  it('leaves players only a secret entry while GM-only', () => {
    const { source, sent, logged } = table();
    source.emit(roll({ hidden: true }));
    expect(rolls(sent)).toEqual([]);
    expect(logged[0]).toMatchObject({ shared: true, mode: 'gm', to: ['gm'], token: null });
    const entry = rollEntry({ id: 'e1', at: 1, who: 'gm', name: 'GM' }, logged[0]!);
    expect(viewOf(entry, 'p'.repeat(20))).toEqual({ id: 'e1', at: 1, who: 'gm', name: 'GM', kind: 'secret', mode: 'gm' });
  });

  it('keeps a contest as two rolls of one contest, without the names of the sides', () => {
    const { source, sent } = table();
    source.emit(roll({ id: 'a', formula: '1d20 vs 10', check, contest: { id: 'c1', side: 'first', names } }));
    source.emit(roll({ id: 'b', formula: '1d20 vs 10', check, contest: { id: 'c1', side: 'second', names, verdict: { winner: 'first', rule: 'builtin:contest-margin' } } }));
    expect(rolls(sent).map((message) => [message.result.contest?.id, message.result.contest?.side])).toEqual([['c1', 'first'], ['c1', 'second']]);
    expect(JSON.stringify(sent)).not.toContain('Ana');
  });

  it('drops the labels of target steps: no token is shown for an off-map roll', () => {
    const { source, sent } = table();
    source.emit(roll({ formula: '1d20 vs 10', check }));
    expect(rolls(sent)[0]?.result.check?.targetSteps).toEqual([{ value: 2 }]);
    expect(JSON.stringify(rolls(sent)[0]?.result.check)).not.toContain('Sneak Attack');
  });

  it('is shared once beside a map roll of the same table', () => {
    const { source, sent, logged } = table();
    const bus = new EventEmitter();
    const dice: DiceSource = { viewId: 'v', rollDice: () => null, rules: () => DEFAULT_DICE_RULES, on: (event, listener) => bus.on(event, listener), off: (event, listener) => bus.off(event, listener) };
    const mapShare = new RollShare({ send: (body) => sent.push(body), showGmRolls: () => true, scene: () => null, alias: (id) => id, logged: (entry) => logged.push(entry) });
    mapShare.start(dice);
    bus.emit('dice-rolled', roll({ id: 'map' }));
    expect(rolls(sent).map((message) => message.result.id)).toEqual(['map']);
    source.emit(roll({ id: 'off' }));
    expect(rolls(sent).map((message) => message.result.id)).toEqual(['map', 'off']);
    expect(logged).toHaveLength(2);
  });

  it('stops with the table, and starting again does not listen twice', () => {
    const { source, share, sent } = table();
    share.start();
    expect(source.listeners()).toBe(1);
    share.stop();
    expect(source.listeners()).toBe(0);
    source.emit(roll());
    expect(rolls(sent)).toEqual([]);
  });

  it('listens to nothing where the app made no roller', () => {
    const share = new OffMapRollShare(() => null, { send: vi.fn(), showGmRolls: () => true });
    expect(() => { share.start(); share.stop(); }).not.toThrow();
  });
});
