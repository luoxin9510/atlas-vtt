import type { DrawingStroke, NotePin, TextElement } from '../../../../src/app/types';
import type { FogOperation } from '../../../../src/app/types/fogTypes';
import type { InitiativeEntry } from '../../../../src/app/types/initiativeTypes';
import type { ViewState } from '../../../../src/app/types/viewState';
import { MAP_LAYER_INTERVAL_MS } from '../../../../src/app/online/gm/MapLayerShare.ts';
import { TOKEN_INTERVAL_MS } from '../../../../src/app/online/gm/TokenShare.ts';
import { fakeLayers } from '../../online/gm/fakeAtlasTab.ts';
import { boundOwnership } from '../../online/gm/fakeSeats.ts';
import { GENERIC_SOURCE } from '../../online/gm/gmLighting.ts';
import { sceneState, shareHarness, token, type Sent, type ShareHarness } from '../../online/gm/shareHarness.ts';

/** The player the corpus is for. */
export const P1 = 'p'.repeat(20);
const P2 = 'q'.repeat(20);
const MAP = { width: 2000, height: 2000 };
const IMAGES = new Map(['maps/cave.webp', 'art/a.webp', 'art/b.webp', 'art/c.webp'].map((path, index) => [path, new Uint8Array([index + 1])]));

const brush: FogOperation = { id: 'b1', kind: 'fog', timestamp: 2, isErasing: false, type: 'brush', points: [{ x: 1500, y: 1500 }, { x: 1600, y: 1550 }, { x: 1700, y: 1500 }], brushRadius: 40 };
const erase: FogOperation = { id: 'e1', kind: 'fog', timestamp: 3, isErasing: true, type: 'rectangle', x: 1550, y: 1450, width: 80, height: 60 };
const cover: FogOperation = { id: 'cover', kind: 'fog', timestamp: 1, isErasing: false, type: 'rectangle', x: 1400, y: 1400, width: 500, height: 500 };
const pen: DrawingStroke = { id: 'd1', kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x: 100, y: 800 }, { x: 300, y: 820 }], color: '#abcdef', width: 4, opacity: 1 };
const note: TextElement = { id: 't1', kind: 'text', x: 200, y: 600, text: 'Tavern', fontSize: 24, fontFamily: 'serif', color: '#ffffff' };
const pin = (id: string, x: number): NotePin => ({ id, kind: 'pin', x, y: 400, notePath: 'Places/Keep.md', readable: true });
const entry = (tokenId: string, order: number): InitiativeEntry => ({
  id: `e_${tokenId}`, tokenId, name: tokenId, initiative: 20 - order, initiativeModifier: 0, imagePath: '', isActive: order === 0, isNPC: false, order,
});

type State = ReturnType<typeof sceneState> & Partial<Pick<ViewState, 'initiative' | 'initiativeTrackerOpen'>>;

function state(tokenX: number): State {
  const tokens = { a: token('a', { x: 100 + tokenX }), b: token('b', { x: 300 }), c: token('c', { x: 500 }) };
  return {
    ...sceneState({
      grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0, color: '#336699', opacity: 0.4, lineWidth: 1, visible: true } as never,
      objects: { ...sceneState().objects, tokens, fog: { cover, b1: brush, e1: erase }, pins: { p1: pin('p1', 400), p2: pin('p2', 700) }, drawings: { d1: pen }, texts: { t1: note } },
    }),
    initiative: { entries: ['a', 'b', 'c'].map(entry), currentIndex: 0, round: 1, isActive: true, config: { autoSort: true } },
    initiativeTrackerOpen: true,
  };
}

/**
 * Everything the GM's own SceneShare sends one player (`P1`, who owns token `a`) at a table with
 * a map, three tokens, fog (a brush and an erasing rectangle), a grid, two readable pins, a drawing,
 * a text and an initiative of three; then a token moves, so a delta follows. Messages for another
 * player are left out; the order is the order sent.
 */
export async function sceneCorpus(): Promise<{ readonly harness: ShareHarness; readonly sent: Sent[]; readonly forP1: Sent[] }> {
  const seats = boundOwnership([{ id: P1, name: 'Ana' }, { id: P2, name: 'Ben' }]);
  seats.welcome([{ id: P1, name: 'Ana' }, { id: P2, name: 'Ben' }]);
  let current = state(0);
  const harness = shareHarness(current, IMAGES, seats);
  harness.layers = fakeLayers({ state: () => current, source: GENERIC_SOURCE, bounds: MAP, grid: () => ({ size: 70, type: 'square', enabled: true }) });
  seats.onChange(() => harness.share.ownersChanged());
  harness.share.start();
  await harness.set(current);
  seats.give(['a'], {}, P1);
  await harness.advance(TOKEN_INTERVAL_MS);
  await harness.advance(MAP_LAYER_INTERVAL_MS);
  harness.share.resend(P1);
  current = state(50);
  await harness.set(current);
  await harness.advance(TOKEN_INTERVAL_MS);
  await harness.advance(MAP_LAYER_INTERVAL_MS);
  return { harness, sent: harness.sent, forP1: harness.sent.filter(({ to }) => to === undefined || to === P1) };
}
