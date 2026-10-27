import { createStore, type StoreApi } from 'zustand/vanilla';
import type { MessageKey } from '../../../../src/app/i18n/index.ts';
import { TABLE_CODE_PATTERN } from '../../../../src/app/online/protocol/relay.ts';
import type { GmMessage, LogMessage, PlayerMessage } from '../../../../src/app/online/protocol/index.ts';
import { LogState } from '../../../../src/app/online/tableLog/index.ts';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { indexedDbCache, memoryCache } from '../assets/blobCache.ts';
import { closeReasonKey, refusedKey } from '../net/closeReasons.ts';
import { GameFeed } from '../net/GameFeed.ts';
import { seatStore, type SeatStore } from '../net/seatStore.ts';
import { socketUrl, TableSocket, type JoinAs, type SocketLike, type SocketStatus } from '../net/TableSocket.ts';
import { createTableStore, initialTableState, type TableStoreApi } from '../state/tableStore.ts';

/** The table code of a page's `#hash`: 26 characters of `[a-z2-7]`, else null. */
export function tableCodeOf(hash: string): string | null {
  const code = hash.startsWith('#') ? hash.slice(1) : '';
  return TABLE_CODE_PATTERN.test(code) ? code : null;
}

export interface SessionEnv {
  origin: string;
  code: string;
  storage: Storage | null;
  open(url: string): SocketLike;
  indexedDB: IDBFactory | null;
}

/** Which screen the player is on: the join form (with why they are back at it) or the table. */
export type SessionView =
  | { readonly screen: 'form'; readonly reason: MessageKey | null; readonly name: string }
  | { readonly screen: 'table'; readonly name: string };

const TICK_MS = 1000;

function isLogMessage(message: GmMessage): message is Extract<GmMessage, LogMessage> {
  return message.t === 'log' || message.t === 'log-entry' || message.t === 'log-remove' || message.t === 'chat-refused' || message.t === 'people';
}

/** One player's visit to one table: the socket, and what it feeds (state, assets, the log). */
export class Session {
  readonly store: TableStoreApi = createTableStore();
  readonly log = new LogState(() => this.store.getState().self);
  readonly assets: AssetLoader;
  readonly view: StoreApi<SessionView> = createStore<SessionView>(() => ({ screen: 'form', reason: null, name: '' }));
  private readonly seats: SeatStore;
  private readonly feed: GameFeed;
  private socket: TableSocket | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private hadKey = false;
  private name = '';

  constructor(private readonly env: SessionEnv) {
    this.seats = seatStore(env.storage);
    this.assets = new AssetLoader({
      send: (body) => void this.send(body),
      cache: env.indexedDB === null ? memoryCache() : indexedDbCache(env.indexedDB),
      now: () => Date.now(),
    });
    this.feed = new GameFeed({
      send: (body) => void this.send(body),
      apply: (message) => this.apply(message),
      yourCode: (message) => {
        this.seats.writeOwnCode(env.code, message.code);
        this.store.setOwnCode(message.code);
      },
      now: () => Date.now(),
    });
    const own = this.seats.ownCode(env.code);
    if (own !== null) this.store.setOwnCode(own);
    const seat = this.seats.read(env.code);
    if (seat !== null) this.join({ name: seat.name, key: seat.key });
  }

  join(as: JoinAs): void {
    this.leave();
    this.name = as.name;
    this.hadKey = as.key !== undefined;
    this.view.setState({ screen: 'table', name: as.name }, true);
    this.store.setStatus({ kind: 'connecting' });
    this.socket = new TableSocket({
      url: socketUrl(this.env.origin, this.env.code),
      join: as,
      open: (url) => this.env.open(url),
      onStatus: (status) => this.onStatus(status),
      onGame: (body) => this.feed.receive(body),
      onSeat: (seat) => {
        this.hadKey = true;
        this.seats.write(this.env.code, { id: seat.id, key: seat.key, name: this.name });
      },
    });
    this.socket.start();
    this.ticker = setInterval(() => this.assets.tick(), TICK_MS);
  }

  /** Close the socket and stop the asset clock; the table's state goes with it. */
  leave(): void {
    this.socket?.stop();
    this.socket = null;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    this.assets.cancelAll();
    this.feed.reset();
    const { ownCode } = this.store.getState();
    this.store.setState({ ...initialTableState(), ownCode }, true);
  }

  /** Back to the join form (the name stays filled in), optionally saying why. */
  backToForm(reason: MessageKey | null = null): void {
    this.leave();
    this.view.setState({ screen: 'form', reason, name: this.name }, true);
  }

  send(body: PlayerMessage): boolean {
    return this.socket?.send(body) ?? false;
  }

  private onStatus(status: SocketStatus): void {
    if (status.kind === 'retrying') this.feed.reset();
    if (status.kind === 'refused' && refusedKey(status.code, this.hadKey)) {
      this.seats.forget(this.env.code);
      this.backToForm(closeReasonKey(status.code));
      return;
    }
    this.store.setStatus(status);
  }

  private apply(message: GmMessage): void {
    if (this.assets.receive(message)) return;
    if (isLogMessage(message)) this.log.receive(message);
    else this.store.applyMessage(message, Date.now());
  }
}
