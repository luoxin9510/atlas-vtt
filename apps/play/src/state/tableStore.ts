import { createStore, type StoreApi } from 'zustand/vanilla';
import type { RollRefusal } from '../../../../src/app/online/protocol/dice.ts';
import type { SharedFog } from '../../../../src/app/online/protocol/fog.ts';
import type { GmMessage, SharedScene } from '../../../../src/app/online/protocol/game.ts';
import type { SensedMark, SharedDoor } from '../../../../src/app/online/protocol/mapLayers.ts';
import type { SharedLightingScene, SharedSight } from '../../../../src/app/online/protocol/lighting.ts';
import type { AssetRef } from '../../../../src/app/online/protocol/index.ts';
import type { SharedInitiative } from '../../../../src/app/online/protocol/initiative.ts';
import type { SharedAnnotations, SharedGrid, SharedPin } from '../../../../src/app/online/protocol/mapLayers.ts';
import type { SharedRules } from '../../../../src/app/online/protocol/rules.ts';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';
import type { SocketStatus } from '../net/TableSocket.ts';
import { sceneMode, type SceneMode } from './sceneMode.ts';

/** What the GM sent a lit scene's lighting is worked out from, for the current scene (cleared with it). */
export interface LitInputs {
  lighting: SharedLightingScene | null;
  sight: SharedSight | null;
  explored: AssetRef | null;
  doors: readonly SharedDoor[];
  sensed: readonly SensedMark[];
}

export interface TableState {
  status: SocketStatus;
  self: string | null;
  ownCode: string | null;
  scene: SharedScene | null;
  mode: SceneMode;
  tokens: readonly SharedToken[];
  cell: number;
  /** undefined: not received yet, so nothing of the map is drawn. */
  fog: SharedFog | undefined;
  grid: SharedGrid | null;
  pins: readonly SharedPin[];
  annotations: SharedAnnotations;
  initiative: SharedInitiative | null;
  rules: SharedRules | null;
  mine: ReadonlySet<string>;
  yourTurnAt: number | null;
  rollRefusal: RollRefusal | null;
  selected: string | null;
  lit: LitInputs;
}

export interface TableActions {
  applyMessage(message: GmMessage, now: number): void;
  setStatus(status: SocketStatus): void;
  setOwnCode(code: string): void;
  select(id: string | null): void;
  dismissYourTurn(): void;
  clearRollRefusal(): void;
}

export type TableStore = StoreApi<TableState> & TableActions;
export type TableStoreApi = TableStore;

const NO_LIT: LitInputs = { lighting: null, sight: null, explored: null, doors: [], sensed: [] };
const NO_ANNOTATIONS: SharedAnnotations = { drawings: [], texts: [] };

/** Everything that belongs to the shared scene; the table's own state (status, code, refusal) stays out. */
const EMPTY_SCENE_LAYER = {
  tokens: [] as readonly SharedToken[],
  cell: 0,
  fog: undefined,
  grid: null,
  pins: [] as readonly SharedPin[],
  annotations: NO_ANNOTATIONS,
  initiative: null,
  rules: null,
  mine: new Set<string>() as ReadonlySet<string>,
  yourTurnAt: null,
  selected: null,
  lit: NO_LIT,
} satisfies Partial<TableState>;

export function initialTableState(): TableState {
  return { status: { kind: 'connecting' }, self: null, ownCode: null, scene: null, mode: 'none', rollRefusal: null, ...EMPTY_SCENE_LAYER };
}

/** What a lit scene keeps of the messages its lighting is worked out from; nothing is drawn from them here. */
function reduceLit(state: TableState, message: GmMessage): Partial<TableState> {
  switch (message.t) {
    case 'lighting': {
      const { t: _t, scene: _scene, ...lighting } = message;
      return { lit: { ...state.lit, lighting } };
    }
    case 'sight': {
      const { t: _t, scene: _scene, seq: _seq, ...sight } = message;
      return { lit: { ...state.lit, sight } };
    }
    case 'explored':
      return { lit: { ...state.lit, explored: message.mask } };
    case 'doors':
      return { lit: { ...state.lit, doors: message.doors } };
    case 'sensed':
      return { lit: { ...state.lit, sensed: message.tokens } };
    default:
      return {};
  }
}

/** The change one message makes (pure: no store, no clock); an empty object when it changes nothing. */
export function reduceMessage(state: TableState, message: GmMessage, now: number): Partial<TableState> {
  if (message.t === 'scene') {
    const scene = message.scene;
    const mode = sceneMode(scene);
    const sameScene = scene !== null && scene.id === state.scene?.id;
    // A resend of an unlit scene keeps its picture; a new scene, no scene, or a scene turned lit keeps nothing.
    if (sameScene && mode === 'map') return { scene, mode };
    return { ...EMPTY_SCENE_LAYER, scene, mode };
  }
  if (message.t === 'roll-refused') return { rollRefusal: message.reason };
  if (!('scene' in message) || typeof message.scene !== 'string') return {};
  if (message.scene !== state.scene?.id) return {};
  if (state.mode === 'lit-placeholder') return reduceLit(state, message);
  if (state.mode !== 'map') return {};
  switch (message.t) {
    case 'tokens': {
      const selected = state.selected !== null && message.tokens.some((token) => token.id === state.selected) ? state.selected : null;
      return { tokens: message.tokens, cell: message.cell, selected };
    }
    case 'mine':
      return { mine: new Set(message.tokens) };
    case 'fog':
      return { fog: message.fog };
    case 'grid':
      return { grid: message.grid };
    case 'pins':
      return { pins: message.pins };
    case 'annotations':
      return { annotations: { drawings: message.drawings, texts: message.texts } };
    case 'initiative':
      return { initiative: message.list };
    case 'rules': {
      return { rules: { grid: message.grid, snap: message.snap, measurement: message.measurement, accent: message.accent, ...(message.cursors && { cursors: message.cursors }), ...(message.dice && { dice: message.dice }) } };
    }
    case 'your-turn':
      return { yourTurnAt: now };
    default:
      // lighting, sight, explored, doors and sensed belong to lit scenes; widgets and the rest are ignored.
      return {};
  }
}

export function createTableStore(): TableStore {
  const store = createStore<TableState>(() => initialTableState());
  return Object.assign(store, {
    applyMessage(message: GmMessage, now: number): void {
      const change = reduceMessage(store.getState(), message, now);
      if (Object.keys(change).length > 0) store.setState(change);
    },
    setStatus(status: SocketStatus): void {
      store.setState({ status, ...(status.kind === 'joined' && { self: status.id }) });
    },
    setOwnCode(code: string): void {
      store.setState({ ownCode: code });
    },
    select(id: string | null): void {
      store.setState({ selected: id });
    },
    dismissYourTurn(): void {
      store.setState({ yourTurnAt: null });
    },
    clearRollRefusal(): void {
      if (store.getState().rollRefusal !== null) store.setState({ rollRefusal: null });
    },
  });
}
