import type { GmMessage } from '../../../../src/app/online/protocol/index.ts';
import { describe, expect, it } from 'vitest';
import { ForkClients } from '../../../../src/app/online/gm/forkClients.ts';
import { YourTurnShare } from '../../../../src/app/online/gm/YourTurnShare.ts';
import { TOKEN_INTERVAL_MS } from '../../../../src/app/online/gm/TokenShare.ts';
import { boundOwnership } from './fakeSeats.ts';
import { sceneState, shareHarness, token } from './shareHarness.ts';
import type { SceneState } from '../../../../src/app/online/gm/atlasView.ts';
import { createDefaultInitiativeState, type InitiativeEntry, type InitiativeState } from '../../../../src/app/types/initiativeTypes';

const P1 = 'a'.repeat(20);
const P2 = 'b'.repeat(20);

describe('ForkClients', () => {
  it('knows the level a player declared, 0 for one who declared none, and forgets it', () => {
    const clients = new ForkClients();
    expect(clients.levelOf(P1)).toBe(0);
    clients.record(P1, { t: 'client', app: 'atlas-fork-play', forkLevel: 1 });
    expect(clients.levelOf(P1)).toBe(1);
    expect(clients.levelOf(P2)).toBe(0);
    clients.forget(P1);
    expect(clients.levelOf(P1)).toBe(0);
  });

  it('takes a client message from the message chain and leaves every other message to it', () => {
    const clients = new ForkClients();
    expect(clients.receive(P1, { t: 'client', app: 'atlas-fork-play', forkLevel: 1 })).toBe(true);
    expect(clients.levelOf(P1)).toBe(1);
    expect(clients.receive(P1, { t: 'resync', scene: 's', of: 'tokens' })).toBe(false);
    expect(clients.receive(P2, { t: 'client', app: 'x', forkLevel: 1.5 })).toBe(false);
    expect(clients.levelOf(P2)).toBe(0);
  });

  it('reads level 0 for a player who rejoins after leaving, until they send client again', () => {
    const clients = new ForkClients();
    clients.receive(P1, { t: 'client', app: 'atlas-fork-play', forkLevel: 1 });
    clients.forget(P1);
    expect(clients.levelOf(P1)).toBe(0);
    clients.receive(P1, { t: 'client', app: 'atlas-fork-play', forkLevel: 1 });
    expect(clients.levelOf(P1)).toBe(1);
  });
});

describe('YourTurnShare', () => {
  function share(): { turn: YourTurnShare; sent: { body: GmMessage; to: string }[]; levels: Map<string, number> } {
    const sent: { body: GmMessage; to: string }[] = [];
    const levels = new Map([[P1, 1], [P2, 0]]);
    const owners: Record<string, string> = { a: P1, b: P2 };
    const turn = new YourTurnShare({ ownerOf: (id) => owners[id], levelOf: (player) => levels.get(player) ?? 0, send: (body, to) => void sent.push({ body, to }) });
    return { turn, sent, levels };
  }
  const told = (sent: { body: GmMessage; to: string }[]): string[] => sent.map(({ body, to }) => `${body.t}:${to === P1 ? 'p1' : 'p2'}`);

  it('tells the owner when their token joins the turn set, once, and not again for the same set', () => {
    const { turn, sent } = share();
    turn.update('s1', new Set());
    turn.update('s1', new Set(['a']));
    expect(sent).toEqual([{ body: { t: 'your-turn', scene: 's1' }, to: P1 }]);
    turn.update('s1', new Set(['a']));
    turn.update('s1', new Set(['a']));
    expect(sent).toHaveLength(1);
  });

  it('tells nobody whose app declared no fork level, and nobody of a token without an owner', () => {
    const { turn, sent } = share();
    turn.update('s1', new Set());
    turn.update('s1', new Set(['b', 'gm-token']));
    expect(sent).toEqual([]);
  });

  it('tells again when the turn comes back to a token, and a player once for several tokens', () => {
    const { turn, sent } = share();
    turn.update('s1', new Set());
    turn.update('s1', new Set(['a']));
    turn.update('s1', new Set(['b']));
    turn.update('s1', new Set(['a']));
    expect(told(sent)).toEqual(['your-turn:p1', 'your-turn:p1']);
    const more = share();
    more.turn.update('s1', new Set());
    more.turn.update('s1', new Set(['a', 'a2']));
    expect(more.sent).toHaveLength(1);
  });

  it('does not tell on a scene\'s first set nor after a reset, even with the turn already held', () => {
    const { turn, sent } = share();
    turn.update('s1', new Set(['a']));
    turn.update('s2', new Set(['a']));
    expect(sent).toEqual([]);
    turn.reset();
    turn.update('s2', new Set(['a']));
    expect(sent).toEqual([]);
  });

  it('does not tell a player who reconnects: the GM sending everything again is no change of the set', () => {
    const { turn, sent, levels } = share();
    turn.update('s1', new Set());
    turn.update('s1', new Set(['a']));
    levels.delete(P1);
    levels.set(P1, 1);
    turn.update('s1', new Set(['a']));
    expect(sent).toHaveLength(1);
  });
});

const entry = (tokenId: string, order: number, active: boolean): InitiativeEntry => ({
  id: `e-${tokenId}`, tokenId, name: tokenId, initiative: 10, initiativeModifier: 0, imagePath: '', isActive: active, isNPC: true, order,
});
const fight = (active: string): InitiativeState => ({ ...createDefaultInitiativeState(), isActive: true, round: 1, entries: [entry('hero', 0, active === 'hero'), entry('ogre', 1, active === 'ogre'), entry('elf', 2, active === 'elf')] });

describe('your-turn through the scene share', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x03, 0xe8, 0, 0, 0x03, 0x20, 8, 6]);
  const withTurn = (active: string, hidden = false): SceneState => ({
    ...sceneState({ background: 'maps/cave.png', objects: { ...sceneState().objects, tokens: { hero: token('hero', { x: 105 }), ogre: token('ogre', { x: 315 }), elf: token('elf', { x: 500, ...(hidden && { isHidden: true }) }) } } }),
    initiative: fight(active), initiativeTrackerOpen: true,
  } as SceneState);

  async function table(levels: Record<string, number>): Promise<{ gm: ReturnType<typeof shareHarness>; go: (active: string, hidden?: boolean) => Promise<void>; turns: () => string[] }> {
    const owners = boundOwnership([{ id: P1, name: 'Ana' }, { id: P2, name: 'Ben' }]);
    owners.welcome([{ id: P1, name: 'Ana' }, { id: P2, name: 'Ben' }]);
    owners.give(['hero'], {}, P1);
    owners.give(['elf'], {}, P2);
    const gm = shareHarness(withTurn('ogre'), new Map([['maps/cave.png', PNG]]), owners);
    gm.settings = { ...gm.settings, showInitiative: true };
    gm.forkLevels = new Map(Object.entries(levels));
    gm.share.start();
    const go = async (active: string, hidden = false): Promise<void> => {
      await gm.set(withTurn(active, hidden));
      await gm.advance(TOKEN_INTERVAL_MS);
    };
    await go('ogre');
    return { gm, go, turns: () => gm.sent.filter(({ body }) => body.t === 'your-turn').map(({ to }) => (to === P1 ? 'p1' : to === P2 ? 'p2' : String(to))) };
  }

  it('sends exactly one your-turn to the owner when advancing initiative gives their token the turn, and none to others', async () => {
    const { gm, go, turns } = await table({ [P1]: 1, [P2]: 1 });
    expect(turns()).toEqual([]);
    await go('hero');
    expect(turns()).toEqual(['p1']);
    expect(gm.sent.find(({ body }) => body.t === 'your-turn')?.body).toMatchObject({ t: 'your-turn', scene: expect.any(String) });
    await go('hero');
    await gm.advance(2000);
    expect(turns()).toEqual(['p1']);
  });

  it('sends nothing to an app without the level, nor on a resend of everything', async () => {
    const { gm, go, turns } = await table({ [P1]: 0, [P2]: 1 });
    await go('hero');
    expect(turns()).toEqual([]);
    await go('elf');
    expect(turns()).toEqual(['p2']);
    gm.share.resend();
    gm.share.resend(P2);
    await gm.advance(TOKEN_INTERVAL_MS * 3);
    expect(turns()).toEqual(['p2']);
  });

  it('never tells a player of the turn of a token the list does not show them', async () => {
    const { go, turns } = await table({ [P1]: 1, [P2]: 1 });
    await go('elf', true);
    expect(turns()).toEqual([]);
  });
});
