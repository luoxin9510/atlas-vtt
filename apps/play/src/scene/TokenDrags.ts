import type { Point } from '../../../../src/app/grid/hexGeometry.ts';
import type { PlayerMessage } from '../../../../src/app/online/protocol/index.ts';
import type { TableStore } from '../state/tableStore.ts';
import { DragController } from './DragController.ts';
import type { Gesture } from './gestures.ts';
import { TokenOverrides } from './liveTokens.ts';
import type { TokenLayer } from './TokenLayer.ts';

export interface TokenDragsOptions {
  store: TableStore;
  tokens: TokenLayer;
  send(body: PlayerMessage): boolean;
  toWorld(x: number, y: number): Point;
  /** Whether the scene is drawn: tokens are drawn only then. */
  shown(): boolean;
}

/** The tokens' places on screen: the list's, other screens' live drags over it, and the local drag's preview over both. */
export class TokenDrags {
  private readonly overrides = new TokenOverrides();
  private readonly controller: DragController;
  private destroyed = false;

  constructor(private readonly options: TokenDragsOptions) {
    const { store, send, toWorld } = options;
    this.controller = new DragController({ send, store, toWorld, now: () => performance.now(), preview: (id, at) => { this.overrides.set(id, at); this.draw(); } });
  }

  handle(gesture: Gesture): void {
    this.controller.handle(gesture);
  }

  /** Draws the tokens where they belong now; nothing while the scene is not drawn. */
  draw(): void {
    const { store, tokens, shown } = this.options;
    const state = store.getState();
    if (!this.destroyed && shown()) tokens.sync(this.overrides.apply(state.tokens, state.live), state.mine, state.selected, state.cell);
  }

  destroy(): void {
    this.destroyed = true;
    this.controller.destroy();
  }
}
