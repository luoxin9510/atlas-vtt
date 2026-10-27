import type { GmMessage, RollMode } from '../../../../src/app/online/protocol/index.ts';
import type { TokenEntity } from '../../../../src/app/types';
import { describe, expect, it } from 'vitest';
import { TableLog } from '../../../../src/app/online/gm/log/TableLog.ts';
import { TOKEN_INTERVAL_MS } from '../../../../src/app/online/gm/TokenShare.ts';
import { boundOwnership } from './fakeSeats.ts';
import { DICE_TOOL, realDice, type DiceToolClass } from './realDice.ts';
import { sceneState, shareHarness, token, tokenLists } from './shareHarness.ts';

const { DiceTool } = (await import(/* @vite-ignore */ DICE_TOOL)) as { DiceTool: DiceToolClass };

const P1 = 'a'.repeat(20);
const P2 = 'b'.repeat(20);
const NAMES: Record<string, string> = { [P1]: 'Ana', [P2]: 'Ben' };
const ART = new Map([['maps/cave.webp', new Uint8Array([1])], ['art/hero.webp', new Uint8Array([2])]]);
const HERO: TokenEntity = { ...token('hero', { x: 1 }), kind: 'character', name: 'Hero' };

interface Out {
  readonly body: GmMessage;
  readonly to: string | undefined;
}

/** A shared scene with real dice whose logged rolls go into a real table log; everything either sends is kept. */
async function table(): Promise<{ roll: (mode: RollMode) => string; seenBy: (player: string) => string; wire: Out[] }> {
  const wire: Out[] = [];
  const owners = boundOwnership([{ id: P1, name: 'Ana' }, { id: P2, name: 'Ben' }]);
  owners.welcome([{ id: P1, name: 'Ana' }, { id: P2, name: 'Ben' }]);
  const state = sceneState({ objects: { ...sceneState().objects, tokens: { hero: HERO } } });
  const gm = shareHarness(state, ART, owners);
  let clock = 0;
  const log = new TableLog({
    send: (body, to) => void wire.push({ body, to }),
    clock: () => 1_700_000_000_000 + clock,
    now: () => clock,
    randomId: () => (clock += 1).toString(16).padStart(24, '0'),
    nameOf: (player) => NAMES[player] ?? null,
    setTimer: () => 0,
    clearTimer: () => undefined,
    changed: () => undefined,
  });
  log.welcome([{ id: P1, name: 'Ana' }, { id: P2, name: 'Ben' }]);
  gm.dice = realDice(DiceTool, { defaultRoll: '1d20', crit: 'natural' }, () => 0.5).dice;
  gm.share.start();
  await gm.set(state);
  await gm.advance(TOKEN_INTERVAL_MS);
  owners.give(['hero'], {}, P1);
  const scene = tokenLists(gm.sent).at(-1)?.scene ?? '';
  const roll = (mode: RollMode): string => {
    const before = gm.logged.length;
    gm.share.receive(P1, { t: 'roll', scene, formula: '1d20 + 7', token: null, mode });
    // A public roll is announced to all by the share and logged by Atlas's own roll stream; private ones are handed to the log.
    gm.logged.slice(before).forEach((logged) => log.rolled(logged));
    const sent = gm.sent.flatMap(({ body }) => (body.t === 'roll' ? [body.result.id] : []));
    return gm.logged[before]?.roll.id ?? sent.at(-1) ?? '';
  };
  const seenBy = (player: string): string => {
    log.resend(player);
    const heard = [...wire, ...gm.sent].filter(({ to }) => to === player || to === undefined);
    return JSON.stringify(heard.map(({ body }) => body));
  };
  return { roll, seenBy, wire: [...wire, ...gm.sent] };
}

describe('who hears a player\'s roll', () => {
  it.each<RollMode>(['gm', 'blind', 'self'])('a %s roll by one player reaches another player\'s log, people and roll streams as nothing but the log\'s placeholder', async (mode) => {
    const { roll, seenBy } = await table();
    const id = roll(mode);
    expect(id).not.toBe('');
    const heard = seenBy(P2);
    // No roll message, no result, formula or dice: the stream holds the roll's id only in the log's `secret` line (who and mode, as designed)
    expect(heard).not.toContain('"t":"roll"');
    for (const content of ['1d20', '"total"', '"rolls"', '"result"', '"roll":']) expect(heard).not.toContain(content);
    const lines = (JSON.parse(heard) as { t: string; entry?: Record<string, unknown>; entries?: Record<string, unknown>[] }[]).flatMap((body) => body.entry ?? body.entries ?? []);
    expect(lines.filter((line) => line.id === id).map((line) => Object.keys(line).sort())).not.toEqual([]);
    for (const line of lines.filter((line) => line.id === id)) expect(line).toEqual({ id, at: expect.any(Number), who: P1, name: 'Ana', kind: 'secret', mode });
    // People carry presence only
    for (const body of JSON.parse(heard) as { t: string; people?: Record<string, unknown>[] }[]) for (const person of body.people ?? []) expect(Object.keys(person).sort()).toEqual(['id', 'name']);
  });

  it('a self roll is thrown on its roller\'s page alone, and a blind one on nobody\'s', async () => {
    const own = await table();
    const id = own.roll('self');
    expect(own.seenBy(P1)).toContain(id);
    const blind = await table();
    expect(blind.seenBy(P1)).not.toContain(blind.roll('blind'));
  });

  it('a public roll is heard by the other player', async () => {
    const { roll, seenBy } = await table();
    const id = roll('public');
    expect(id).not.toBe('');
    expect(seenBy(P2)).toContain(id);
  });
});
