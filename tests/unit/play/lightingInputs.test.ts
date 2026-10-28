import { describe, expect, it, vi } from 'vitest';
import type { SharedLightingScene, SharedSight, SharedWall, SightToken } from '../../../src/app/online/protocol/index.ts';
import { SceneModelBuilder } from '../../../src/app/vision/sceneModel';
import type { MapBounds } from '../../../src/app/vision/visibility';
import { sharedLightingScene, sharedSight } from '../../../src/app/online/gm/sceneInputs.ts';
import type { TokenEntity } from '../../../src/app/types';
import type { SceneState } from '../../../src/app/vision/sceneModel';
import { LightingInputs } from '../../../apps/play/src/lighting/lightingInputs.ts';
import { sightRulesOf } from '../../../apps/play/src/lighting/sightRulesOf.ts';
import { createLightingStore } from '../../../apps/play/src/lighting/lightingStore.ts';
import { createTableStore, initialTableState } from '../../../apps/play/src/state/tableStore.ts';

/** Every renderer package is refused here: the adapter must ask for none. */
const { loaded, refuse } = vi.hoisted(() => {
  const loaded: string[] = [];
  return { loaded, refuse: (name: string) => (): never => { loaded.push(name); throw new Error(`${name} was loaded`); } };
});
vi.mock('pixi.js', refuse('pixi.js'));
vi.mock('pixi-viewport', refuse('pixi-viewport'));
vi.mock('pixi-filters', refuse('pixi-filters'));

const BOUNDS: MapBounds = { width: 600, height: 400 };

const wall = (x1: number, y1: number, x2: number, y2: number, extra: Partial<SharedWall> = {}): SharedWall => ({ p: [x1, y1, x2, y2], ...extra });
/** Two rooms side by side, 100..300 and 300..500, with a divider at x=300 that the test sets. */
const rooms = (divider: SharedWall): SharedLightingScene => ({
  cellSize: 70,
  unitDistance: 5,
  walls: [wall(100, 100, 500, 100), wall(500, 100, 500, 400), wall(500, 400, 100, 400), wall(100, 400, 100, 100), divider],
  zones: [],
  senses: [],
});
const token = (id: string, x: number, extra: Partial<SightToken> = {}): SightToken => ({ id, x, y: 250, size: 1, vision: { senses: [] }, ...extra });
const sightOf = (tokens: SightToken[], extra: Partial<SharedSight> = {}): SharedSight => ({ lighting: { enabled: true, ambient: 1 }, lights: [], tokens, held: [], ...extra });

function build(lighting: SharedLightingScene, sight: SharedSight, inputs = new LightingInputs(), builder = new SceneModelBuilder()): ReturnType<SceneModelBuilder['update']> {
  const state = inputs.update(lighting, sight, BOUNDS);
  const rules = sightRulesOf(lighting, sight);
  return builder.update(state, BOUNDS, () => inputs.measurement(), () => rules);
}
const reach = (result: ReturnType<SceneModelBuilder['update']>): { minX: number; maxX: number } => {
  const xs = result.model.sight.regions.flatMap((region) => region.polygon?.map((point) => point.x) ?? []);
  return { minX: Math.min(...xs), maxX: Math.max(...xs) };
};

describe('lighting inputs', () => {
  it('stops a token\'s sight at the walls of its room', () => {
    const { model } = build(rooms(wall(300, 100, 300, 400)), sightOf([token('a', 200)]));
    expect(model.sight.all).toBe(false);
    expect(model.sight.regions.map((region) => region.tokenId)).toEqual(['a']);
    const { minX, maxX } = reach(build(rooms(wall(300, 100, 300, 400)), sightOf([token('a', 200)])));
    expect(minX).toBeGreaterThanOrEqual(99);
    expect(maxX).toBeLessThanOrEqual(301);
  });

  it('lets sight through an open door and not through a closed one', () => {
    const open = reach(build(rooms(wall(300, 100, 300, 400, { door: 'open' })), sightOf([token('a', 200)])));
    expect(open.maxX).toBeGreaterThan(400);
    const closed = reach(build(rooms(wall(300, 100, 300, 400, { door: 'closed' })), sightOf([token('a', 200)])));
    expect(closed.maxX).toBeLessThanOrEqual(301);
  });

  it('gives a wall that blocks one channel, one direction or limited its settings back', () => {
    const state = new LightingInputs().update(rooms(wall(300, 100, 300, 400, { direction: 'left', blocks: 'sight', limited: true })), sightOf([]), BOUNDS);
    const divider = Object.values(state.objects.walls)[4]!;
    expect(divider).toMatchObject({ kind: 'wall', type: 'solid', p1: { x: 300, y: 100 }, p2: { x: 300, y: 400 }, direction: 'left', blocks: 'sight', limited: true });
    const doors = Object.values(new LightingInputs().update(rooms(wall(300, 100, 300, 400, { door: 'closed' })), sightOf([]), BOUNDS).objects.walls);
    expect(doors[4]).toMatchObject({ type: 'door', closed: true });
  });

  it('reads zones, the grid, lights and held tokens', () => {
    const lighting: SharedLightingScene = { ...rooms(wall(300, 100, 300, 400)), zones: [{ polygon: [320, 20, 580, 20, 580, 120, 320, 120], ambient: 0.8, colour: '#112233' }] };
    const sight = sightOf([token('a', 200)], {
      lights: [{ id: 'l', x: 450, y: 200, emission: { bright: 10, dim: 20, color: '#3366cc', intensity: 1, animation: 'none' }, rotation: 90 }],
      held: [{ id: 'a', x: 180, y: 250 }],
    });
    const state = new LightingInputs().update(lighting, sight, BOUNDS);
    expect(Object.values(state.objects.lightZones ?? {})).toEqual([expect.objectContaining({ kind: 'light-zone', ambient: 0.8, ambientColor: '#112233', polygon: [{ x: 320, y: 20 }, { x: 580, y: 20 }, { x: 580, y: 120 }, { x: 320, y: 120 }] })]);
    expect(state.grid).toEqual({ enabled: true, size: 70, offsetX: 0, offsetY: 0, opacity: 1 });
    expect(state.objects.lights.l).toMatchObject({ kind: 'light', x: 450, y: 200, rotation: 90 });
    expect(state.heldTokens).toEqual({ a: { x: 180, y: 250 } });
    expect(state.lighting).toEqual({ enabled: true, ambient: 1 });
  });

  it('gives no player sight when the GM sends blind with no vision token', () => {
    const result = build(rooms(wall(300, 100, 300, 400)), sightOf([{ id: 'x', x: 200, y: 250, size: 1 }], { blind: true }));
    expect(result.model.sight.all).toBe(false);
    expect(result.model.sight.regions).toEqual([]);
    const sameAgain = new LightingInputs();
    const first = sameAgain.update(rooms(wall(300, 100, 300, 400)), sightOf([], { blind: true }), BOUNDS);
    expect(sameAgain.update(rooms(wall(300, 100, 300, 400)), sightOf([], { blind: true }), BOUNDS).objects.tokens).toBe(first.objects.tokens);
  });

  it('shows nothing for a scene whose only vision token the GM hid (the GM\'s own messages)', () => {
    const hidden: TokenEntity = { id: 'hero', kind: 'token', imagePath: '', x: 200, y: 250, size: 1, isHidden: true, vision: { enabled: true } };
    const state: SceneState = {
      objects: { tokens: { hero: hidden }, walls: { w: { id: 'w', kind: 'wall', type: 'solid', p1: { x: 300, y: 100 }, p2: { x: 300, y: 400 } } }, lights: {}, lightZones: {} },
      lighting: { enabled: true, ambient: 1 },
      grid: { enabled: true, size: 70, offsetX: 0, offsetY: 0, opacity: 1 },
      heldTokens: {},
    };
    const rules = { definitions: [], conditions: [] };
    const measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 } as const;
    const shared = sharedSight({ state, rules, shown: new Set(), tokenAlias: (id) => id, lightAlias: (id) => id });
    expect(shared.blind).toBe(true);
    expect(shared.tokens).toEqual([]);
    const result = build(sharedLightingScene(state, rules, measurement), shared);
    expect(result.model.sight.all).toBe(false);
    expect(result.model.sight.regions).toEqual([]);
  });

  it('gives no sight to a blinded token', () => {
    const result = build(rooms(wall(300, 100, 300, 400)), sightOf([token('a', 200, { effects: ['blinded'] })]));
    expect(result.model.sight.all).toBe(false);
    expect(result.model.sight.regions).toEqual([]);
  });

  it('sees everything when no token has vision', () => {
    const result = build(rooms(wall(300, 100, 300, 400)), sightOf([{ id: 'x', x: 150, y: 150, size: 1 }]));
    expect(result.model.sight.all).toBe(true);
  });

  it('keeps unchanged tokens, walls and lights as the same objects', () => {
    const lighting = rooms(wall(300, 100, 300, 400));
    const inputs = new LightingInputs();
    const builder = new SceneModelBuilder();
    const light = { id: 'l', x: 450, y: 200, emission: { bright: 10, dim: 20, color: '#3366cc', intensity: 1, animation: 'none' } };
    const first = inputs.update(lighting, sightOf([token('a', 100 + 50), token('b', 400)], { lights: [light] }), BOUNDS);
    const rules = sightRulesOf(lighting, sightOf([token('a', 150), token('b', 400)]));
    expect(builder.update(first, BOUNDS, () => inputs.measurement(), () => rules).rebuilt).toBe(true);

    // Nothing changed, in a copy that shares nothing with the first message.
    const same = inputs.update(structuredClone(lighting), structuredClone(sightOf([token('a', 150), token('b', 400)], { lights: [light] })), BOUNDS);
    expect(same.objects.walls).toBe(first.objects.walls);
    expect(same.objects.tokens).toBe(first.objects.tokens);
    expect(same.objects.lights).toBe(first.objects.lights);
    expect(same.grid).toBe(first.grid);
    expect(same.lighting).toBe(first.lighting);
    expect(builder.update(same, BOUNDS, () => inputs.measurement(), () => rules).rebuilt).toBe(false);

    // One token moves.
    const moved = inputs.update(lighting, sightOf([token('a', 170), token('b', 400)], { lights: [light] }), BOUNDS);
    expect(moved.objects.tokens).not.toBe(first.objects.tokens);
    expect(moved.objects.tokens.b).toBe(first.objects.tokens.b);
    expect(moved.objects.tokens.a).not.toBe(first.objects.tokens.a);
    expect(moved.objects.walls).toBe(first.objects.walls);
    expect(moved.objects.lights).toBe(first.objects.lights);
  });

  it('keeps the sight rules while nothing sight goes by changed', () => {
    const lighting = rooms(wall(300, 100, 300, 400));
    const a = sightRulesOf(lighting, sightOf([token('a', 200)]));
    expect(sightRulesOf(lighting, structuredClone(sightOf([token('a', 260)])))).toBe(a);
    expect(sightRulesOf(lighting, sightOf([token('a', 200, { vision: { senses: [{ id: 'x', range: 5 }] } })]))).not.toBe(a);
  });

  it('answers a token\'s vision and the four effects from the messages', () => {
    const lighting = { ...rooms(wall(300, 100, 300, 400)), senses: [{ id: 'bad' }] };
    const rules = sightRulesOf(lighting, sightOf([token('a', 200, { vision: { senses: [{ id: 'darkvision', range: 60 }], sightRange: 30, angle: 90 } }), token('p', 10, { vision: { senses: [], pending: true } })]));
    const probe = { id: 'a', kind: 'token' as const, imagePath: '', x: 0, y: 0 };
    expect(rules.visionOf?.(probe)).toEqual({ senses: [{ id: 'darkvision', range: 60 }], sightRange: 30 });
    expect(rules.visionOf?.({ ...probe, id: 'p' })).toMatchObject({ pending: true });
    expect(rules.visionOf?.({ ...probe, id: 'unknown' })).toMatchObject({ pending: true });
    expect(rules.conditions.map((condition) => [condition.id, condition.effect])).toEqual([['blinded', 'blinded'], ['invisible', 'invisible'], ['airborne', 'airborne'], ['undetected', 'undetected']]);
    expect(rules.definitions).toEqual([]);
  });

  it('is a store satisfying the lighting state', () => {
    const store = createLightingStore();
    expect(store.getState().isMapLoading).toBe(true);
    const state = new LightingInputs().update(rooms(wall(300, 100, 300, 400)), sightOf([token('a', 200)]), BOUNDS);
    store.apply(state, 'data:image/png;base64,AA==');
    const now = store.getState();
    expect(now.isMapLoading).toBe(false);
    expect(now.objects.walls).toBe(state.objects.walls);
    expect(now.exploredMask).toBe('data:image/png;base64,AA==');
    now.setExploredMask('data:other');
    expect(store.getState().exploredMask).toBe('data:other');
    now.setExploredEdits(3);
    expect(store.getState().exploredEdits).toBe(3);
    const walls = now.objects.walls;
    store.apply(state, null);
    expect(store.getState().objects.walls).toBe(walls);
  });

  it('loads no renderer', () => {
    expect(loaded).toEqual([]);
    expect(typeof document).toBe('undefined');
  });
});

describe('table store lighting', () => {
  const scene = (id: string): { t: 'scene'; scene: { id: string; map: null; lit: true } } => ({ t: 'scene', scene: { id, map: null, lit: true } });
  it('keeps the lighting messages of a lit scene and clears them on a scene change', () => {
    const store = createTableStore();
    store.applyMessage(scene('s1') as never, 0);
    expect(store.getState().lit).toEqual({ lighting: null, sight: null, explored: null, doors: [], sensed: [] });
    const lighting = rooms(wall(300, 100, 300, 400));
    const sight = sightOf([token('a', 200)]);
    store.applyMessage({ t: 'lighting', scene: 's1', ...lighting }, 0);
    store.applyMessage({ t: 'sight', scene: 's1', ...sight }, 0);
    store.applyMessage({ t: 'doors', scene: 's1', doors: [{ p: [1, 2, 3, 4], open: true }] } as never, 0);
    store.applyMessage({ t: 'sensed', scene: 's1', tokens: [{ x: 1, y: 2, size: 3 }] } as never, 0);
    store.applyMessage({ t: 'explored', scene: 's1', mask: null }, 0);
    const lit = store.getState().lit;
    expect(lit.lighting).toMatchObject({ cellSize: 70 });
    expect(lit.sight?.tokens.map((entry) => entry.id)).toEqual(['a']);
    expect(lit.doors).toHaveLength(1);
    expect(lit.sensed).toHaveLength(1);
    // A message for another scene changes nothing.
    store.applyMessage({ t: 'sight', scene: 's2', ...sightOf([]) }, 0);
    expect(store.getState().lit.sight?.tokens).toHaveLength(1);
    store.applyMessage(scene('s2') as never, 0);
    expect(store.getState().lit).toEqual(initialTableState().lit);
  });
});
