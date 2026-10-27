import { createStore, type StoreApi } from 'zustand/vanilla';
import type { RollRefusal } from '../../../../src/app/online/protocol/dice.ts';
import type { SharedFog } from '../../../../src/app/online/protocol/fog.ts';
import type { GmMessage, SharedScene } from '../../../../src/app/online/protocol/game.ts';
import type { SharedInitiative } from '../../../../src/app/online/protocol/initiative.ts';
import type { SharedAnnotations, SharedGrid, SharedPin } from '../../../../src/app/online/protocol/mapLayers.ts';
import type { SharedRules } from '../../../../src/app/online/protocol/rules.ts';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';
import type { SocketStatus } from '../net/TableSocket.ts';
import { sceneMode, type SceneMode } from './sceneMode.ts';

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
}

export interface TableActions {
  applyMessage(message: GmMessage, now: number): void;
  setStatus(status: SocketStatus): void;
  setOwnCode(code: string): void;
  select(id: string | null): void;
  dismissYourTurn(): void;
}

export type TableStore = StoreApi<TableState> & TableActions;

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
} satisfies Partial<TableState>;

export function initialTableState(): TableState {
  return { status: { kind: 'connecting' }, self: null, ownCode: null, scene: null, mode: 'none', rollRefusal: null, ...EMPTY_SCENE_LAYER };
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
  if (state.mode !== 'map' || message.scene !== state.scene?.id) return {};
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
      // lighting, sight, explored, doors, sensed, widgets and the rest are ignored in M3.
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
  });
}
