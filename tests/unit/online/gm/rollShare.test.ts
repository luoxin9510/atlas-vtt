import { EventEmitter } from 'node:events';
import { DEFAULT_DICE_RULES } from '../../../../src/app/gameSystems/diceRules';
import type { GmMessage } from '../../../../src/app/online/protocol/index.ts';
import type { DiceRollOrigin } from '../../../../src/app/types/diceRollOrigin';
import type { DiceRollResult } from '../../../../src/app/types/diceTypes';
import type { TokenEntity } from '../../../../src/app/types';
import { describe, expect, it } from 'vitest';
import type { DiceSource } from '../../../../src/app/online/gm/atlasDice.ts';
import { viewOf } from '../../../../src/app/online/gm/log/logEntries.ts';
import { rollEntry } from '../../../../src/app/online/gm/log/logTypes.ts';
import { sharedRoll } from '../../../../src/app/online/gm/RollShare.ts';
import { TOKEN_INTERVAL_MS } from '../../../../src/app/online/gm/TokenShare.ts';
import { sceneState, shareHarness, token, tokenLists, type ShareHarness } from './shareHarness.ts';

const VIEW = 'view-1';
const ART = new Map([['maps/cave.webp', new Uint8Array([1])], ['art/hero.webp', new Uint8Array([2])], ['art/spy.webp', new Uint8Array([3])]]);
const TOKENS: TokenEntity[] = [
  { ...token('hero', { x: 1 }), kind: 'character', name: 'Hero' },
  { ...token('spy', { x: 2, isHidden: true }), kind: 'character', name: 'Spy' },
];

/** A GM roll from a statblock: Atlas's result as its bus announces it, with the GM's own fields. */
const gmRoll = (tokenId: string): DiceRollResult => ({
  id: 'roll_1', timestamp: 1, formula: '1d20 + 4', rolls: [{ die: 'd20', value: 13, max: 20 }], modifiers: 4, total: 17, crit: null, player: 'Player',
  source: { type: 'statblock', tokenId, statblockPath: `Bestiary/${tokenId}.md`, tokenName: tokenId, tokenImagePath: `art/${tokenId}.webp`, abilityName: 'Sneak Attack' },
});

async function table(showDiceRolls: boolean): Promise<ShareHarness & { readonly bus: EventEmitter; readonly heroAlias: string }> {
  const state = sceneState({ objects: { ...sceneState().objects, tokens: Object.fromEntries(TOKENS.map((entry) => [entry.id, entry])) } });
  const share = shareHarness(state, ART);
  const bus = new EventEmitter();
  const dice: DiceSource = { viewId: VIEW, rollDice: () => null, rules: () => DEFAULT_DICE_RULES, on: (event, listener) => bus.on(event, listener), off: (event, listener) => bus.off(event, listener) };
  share.dice = dice;
  share.settings = { ...share.settings, showDiceRolls };
  share.share.start();
  await share.set(state);
  await share.advance(TOKEN_INTERVAL_MS);
  return Object.assign(share, { bus, heroAlias: tokenLists(share.sent).at(-1)?.tokens.find((entry) => entry.x === 1)?.id ?? '' });
}

const origin = (tokenId: string, viewId = VIEW): DiceRollOrigin => ({ viewId, mapPath: sceneState().mapPath ?? '', tokenId });
const rollsSent = (sent: ShareHarness['sent']): Extract<GmMessage, { t: 'roll' }>[] => sent.flatMap(({ body }) => (body.t === 'roll' ? [body] : []));

describe('the GM\'s rolls', () => {
  it('are withheld while the player view does not show dice rolls', async () => {
    const gm = await table(false);
    gm.bus.emit('dice-rolled', gmRoll('hero'), origin('hero'));
    expect(rollsSent(gm.sent)).toEqual([]);
  });

  it('go to everyone while it does, naming a token players see by its alias with the ability rolled', async () => {
    const gm = await table(true);
    gm.bus.emit('dice-rolled', gmRoll('hero'), origin('hero'));
    expect(rollsSent(gm.sent)).toEqual([{
      t: 'roll', who: 'gm', token: gm.heroAlias,
      result: { id: 'roll_1', timestamp: 1, formula: '1d20 + 4', rolls: [{ die: 'd20', value: 13, max: 20 }], modifiers: 4, total: 17, crit: null, source: { type: 'statblock', abilityName: 'Sneak Attack' } },
    }]);
  });

  it('name the constants the roll names, so players see each as its own term', async () => {
    const gm = await table(true);
    const named: DiceRollResult = { ...gmRoll('hero'), formula: '1d20+4-1[Str mod]', modifiers: 3, total: 16, namedModifiers: [{ label: 'Str mod', value: -1 }] };
    gm.bus.emit('dice-rolled', named, origin('hero'));
    expect(rollsSent(gm.sent)[0]?.result).toMatchObject({ formula: '1d20+4-1[Str mod]', modifiers: 3, namedModifiers: [{ label: 'Str mod', value: -1 }] });
    gm.bus.emit('dice-rolled', gmRoll('hero'), origin('hero'));
    expect(rollsSent(gm.sent)[1]?.result).not.toHaveProperty('namedModifiers');
  });

  it('never name a hidden token, nor what it rolled, nor a token of another view', async () => {
    const gm = await table(true);
    gm.bus.emit('dice-rolled', gmRoll('spy'), origin('spy'));
    gm.bus.emit('dice-rolled', gmRoll('hero'), origin('hero', 'view-2'));
    gm.bus.emit('dice-rolled', gmRoll('hero'));
    const sent = rollsSent(gm.sent);
    expect(sent.map((roll) => [roll.token, roll.result.source])).toEqual([[null, { type: 'statblock' }], [null, { type: 'statblock' }], [null, { type: 'statblock' }]]);
    expect(JSON.stringify(sent)).not.toMatch(/spy|Spy|Sneak|Bestiary|art\/|Player/);
  });

  it('stop with the share', async () => {
    const gm = await table(true);
    gm.share.stop();
    gm.bus.emit('dice-rolled', gmRoll('hero'), origin('hero'));
    expect(rollsSent(gm.sent)).toEqual([]);
    expect(gm.bus.listenerCount('dice-rolled')).toBe(0);
  });
});

describe('the GM\'s GM-only rolls', () => {
  const secretRoll = (): DiceRollResult => ({ ...gmRoll('hero'), hidden: true });

  it('are never sent to players as a roll, even while the player view shows dice rolls', async () => {
    const gm = await table(true);
    gm.bus.emit('dice-rolled', secretRoll(), origin('hero'));
    expect(rollsSent(gm.sent)).toEqual([]);
  });

  it('go into the log as a private roll for the GM alone, without the flag in what players parse', async () => {
    const gm = await table(true);
    gm.bus.emit('dice-rolled', secretRoll(), origin('hero'));
    expect(gm.logged).toHaveLength(1);
    expect(gm.logged[0]).toMatchObject({ who: 'gm', shared: true, mode: 'gm', to: ['gm'], token: null });
    expect(gm.logged[0]?.roll).toMatchObject({ total: 17, formula: '1d20 + 4' });
    expect(gm.logged[0]?.roll).not.toHaveProperty('hidden');
  });

  it('leave players no trace while the player view shows no GM rolls, like any GM roll', async () => {
    const gm = await table(false);
    gm.bus.emit('dice-rolled', secretRoll(), origin('hero'));
    expect(rollsSent(gm.sent)).toEqual([]);
    expect(gm.logged).toHaveLength(1);
    expect(gm.logged[0]).toMatchObject({ shared: false });
    expect(gm.logged[0]).not.toHaveProperty('mode');
  });

  it('show players a secret entry and the GM the whole roll', async () => {
    const gm = await table(true);
    gm.bus.emit('dice-rolled', secretRoll(), origin('hero'));
    const entry = rollEntry({ id: 'e1', at: 1, who: 'gm', name: 'GM' }, gm.logged[0]!);
    expect(viewOf(entry, 'gm')).toMatchObject({ kind: 'roll', roll: { total: 17 } });
    expect(viewOf(entry, 'p'.repeat(20))).toEqual({ id: 'e1', at: 1, who: 'gm', name: 'GM', kind: 'secret', mode: 'gm' });
  });
});

describe('sharedRoll and checks', () => {
  it('carries a roll\'s check to the players, and nothing for a roll without one', () => {
    const check = { target: 10, direction: 'over' as const, margin: 2, success: true, crit: null, rule: 'builtin:margin' };
    expect(sharedRoll({ ...gmRoll('hero'), formula: '1d20+4 vs 10', check }).check).toEqual(check);
    expect(sharedRoll(gmRoll('hero'))).not.toHaveProperty('check');
  });
});

describe('a contest on the wire', () => {
  const names = { first: 'Ana', second: 'Bo' };
  const check = { target: 10, direction: 'over' as const, margin: 2, success: true, crit: null, rule: 'builtin:margin' };
  const pair = (extra: Partial<DiceRollResult> = {}): [DiceRollResult, DiceRollResult] => [
    { ...gmRoll('hero'), id: 'a', formula: '1d20 vs 10', check, contest: { id: 'c1', side: 'first', names }, ...extra },
    { ...gmRoll('hero'), id: 'b', formula: '1d20 vs 10', check, contest: { id: 'c1', side: 'second', names, verdict: { winner: 'first', rule: 'builtin:contest-margin' } }, ...extra },
  ];

  it('is carried by sharedRoll with its verdict, and never with the names of the sides', () => {
    const [first, second] = pair();
    expect(sharedRoll(first).contest).toEqual({ id: 'c1', side: 'first' });
    expect(sharedRoll(second).contest).toEqual({ id: 'c1', side: 'second', verdict: { winner: 'first', rule: 'builtin:contest-margin' } });
    expect(JSON.stringify(sharedRoll(second))).not.toContain('Ana');
    expect(sharedRoll(gmRoll('hero'))).not.toHaveProperty('contest');
  });

  it('reaches the players as two rolls of one contest, without the names', async () => {
    const gm = await table(true);
    for (const roll of pair()) gm.bus.emit('dice-rolled', roll, origin('hero'));
    const sent = rollsSent(gm.sent);
    expect(sent.map((message) => message.result.contest?.side)).toEqual(['first', 'second']);
    expect(JSON.stringify(sent)).not.toContain('Ana');
  });

  it('is hidden from players while GM-only: both rolls are secret entries, nothing of the contest is sent', async () => {
    const gm = await table(true);
    for (const roll of pair({ hidden: true })) gm.bus.emit('dice-rolled', roll, origin('hero'));
    expect(rollsSent(gm.sent)).toEqual([]);
    expect(gm.logged).toHaveLength(2);
    const [one, two] = gm.logged.map((logged, i) => rollEntry({ id: `e${i}`, at: 1, who: 'gm', name: 'GM' }, logged));
    for (const entry of [one!, two!]) {
      expect(viewOf(entry, 'p'.repeat(20))).toEqual({ id: entry.id, at: 1, who: 'gm', name: 'GM', kind: 'secret', mode: 'gm' });
    }
    expect(viewOf(two!, 'gm')).toMatchObject({ kind: 'roll', roll: { contest: { side: 'second' } } });
  });
});
