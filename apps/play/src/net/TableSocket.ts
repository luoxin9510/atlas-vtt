import { FORK_APP, FORK_PROTOCOL_LEVEL } from '../../../../src/app/online/protocol/fork.ts';
import {
  FINAL_CLOSE_CODES, KEEPALIVE_MS, KEEPALIVE_PING, MAX_PLAYER_FRAME, parseRelayFrame, type PlayerHello, type PlayerInfo,
} from '../../../../src/app/online/protocol/relay.ts';
import { backoffMs } from './backoff.ts';

export { refusedKey } from './closeReasons.ts';

export type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState' | 'bufferedAmount'> & {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
};

export type JoinAs = { readonly name: string; readonly key?: string; readonly code?: string };

export type SocketStatus =
  | { kind: 'connecting' }
  | { kind: 'waiting' }
  | { kind: 'joined'; id: string; gmOnline: boolean }
  | { kind: 'retrying'; inMs: number }
  | { kind: 'refused'; code: number };

export interface TableSocketOptions {
  url: string;
  join: JoinAs;
  open: (url: string) => SocketLike;
  now?: () => number;
  random?: () => number;
  onStatus(status: SocketStatus): void;
  onGame(body: unknown): void;
  onSeat(seat: { id: string; key: string }): void;
}

/** How long after a ping some frame (a `pong` counts) must arrive before the socket is taken for dead. */
const DEAD_AFTER_MS = 20_000;
/** How long a new socket may take to send its first frame before it is replaced. */
export const OPEN_TIMEOUT_MS = 10_000;
const OPEN = 1;
const encoder = new TextEncoder();

/** `wss:`/`ws:` URL of a table's socket on the page's own origin. */
export function socketUrl(origin: string, code: string): string {
  const url = new URL(`/api/tables/${code}/socket`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

type TimerName = 'pingTimer' | 'deadTimer' | 'retryTimer' | 'openTimer';

/** A player's socket to the relay: hello, keep-alive, reconnect with backoff, and the final close codes. */
export class TableSocket {
  private socket: SocketLike | null = null;
  private stopped = true;
  private joined = false;
  /** True once the current socket has sent any frame (the relay's answer to our hello counts as open). */
  private live = false;
  private attempt = 0;
  private seatId = '';
  private key: string | undefined;
  private code: string | undefined;
  private wait: string | undefined;
  private timers: Record<TimerName, ReturnType<typeof setTimeout> | null> = { pingTimer: null, deadTimer: null, retryTimer: null, openTimer: null };

  constructor(private readonly options: TableSocketOptions) {
    this.key = options.join.key;
    this.code = options.join.code;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  /** False when the player has not joined, or the whole frame is over `MAX_PLAYER_FRAME` bytes. */
  send(body: unknown): boolean {
    const socket = this.socket;
    if (!this.joined || socket === null || socket.readyState !== OPEN) return false;
    const frame = JSON.stringify({ v: 1, t: 'send', body });
    if (encoder.encode(frame).length > MAX_PLAYER_FRAME) return false;
    socket.send(frame);
    return true;
  }

  /** The page is awake again or the network is back: reconnect now, or check at once that the socket still answers. */
  wake(): void {
    if (this.stopped) return;
    const socket = this.socket;
    if (socket === null) {
      this.clearTimer('retryTimer');
      this.connect();
      return;
    }
    if (!this.live) return; // still connecting: the open timeout decides
    if (socket.readyState !== OPEN) {
      this.teardown();
      this.connect();
      return;
    }
    socket.send(KEEPALIVE_PING);
    this.armDead();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    this.clearTimer('retryTimer');
  }

  private connect(): void {
    this.options.onStatus({ kind: 'connecting' });
    const socket = this.options.open(this.options.url);
    this.socket = socket;
    this.timers.openTimer = setTimeout(() => { this.timers.openTimer = null; this.teardown(); this.retry(); }, OPEN_TIMEOUT_MS);
    socket.onopen = () => socket.send(JSON.stringify(this.hello()));
    socket.onmessage = (event) => this.onFrame(socket, event.data);
    socket.onclose = (event) => this.onClose(event.code);
    socket.onerror = () => undefined;
  }

  private hello(): PlayerHello {
    return {
      v: 1, t: 'hello', role: 'player', name: this.options.join.name,
      ...(this.key === undefined ? {} : { key: this.key }),
      ...(this.code === undefined ? {} : { code: this.code }),
      waits: true,
      ...(this.wait === undefined ? {} : { wait: this.wait }),
      ...(this.key === undefined && this.code === undefined ? { newcomer: true as const } : {}),
    };
  }

  private onFrame(socket: SocketLike, data: unknown): void {
    this.clearTimer('deadTimer');
    this.clearTimer('openTimer');
    this.live = true;
    if (typeof data !== 'string') return;
    const frame = parseRelayFrame(data);
    if (frame === null) return;
    switch (frame.t) {
      case 'waiting':
        if (frame.wait !== undefined) this.wait = frame.wait;
        this.options.onStatus({ kind: 'waiting' });
        break;
      case 'welcome':
        if (frame.role !== 'player') break;
        this.joined = true;
        this.attempt = 0;
        this.seatId = frame.id;
        this.key = frame.key;
        this.code = undefined;
        this.wait = undefined;
        this.sendClient(socket);
        this.options.onSeat({ id: frame.id, key: frame.key });
        this.options.onStatus({ kind: 'joined', id: frame.id, gmOnline: frame.gmOnline });
        this.startPing();
        break;
      case 'gm':
        if (!this.joined) break;
        // The relay drops player frames while the GM is away, and a restarted GM has forgotten the level: say it again.
        if (frame.online) this.sendClient(socket);
        this.options.onStatus({ kind: 'joined', id: this.seatId, gmOnline: frame.online });
        break;
      case 'game':
        if (this.joined) this.options.onGame(frame.body);
        break;
      default:
        break;
    }
  }

  /** Declares this app's fork level to the GM. */
  private sendClient(socket: SocketLike): void {
    socket.send(JSON.stringify({ v: 1, t: 'send', body: { t: 'client', app: FORK_APP, forkLevel: FORK_PROTOCOL_LEVEL } }));
  }

  private onClose(code: number): void {
    this.teardown();
    if (FINAL_CLOSE_CODES.includes(code)) {
      this.stopped = true;
      this.options.onStatus({ kind: 'refused', code });
      return;
    }
    this.retry();
  }

  private startPing(): void {
    this.clearTimer('pingTimer');
    this.timers.pingTimer = setInterval(() => {
      const socket = this.socket;
      if (socket === null || socket.readyState !== OPEN) return;
      socket.send(KEEPALIVE_PING);
      this.armDead();
    }, KEEPALIVE_MS);
  }

  private armDead(): void {
    this.clearTimer('deadTimer');
    this.timers.deadTimer = setTimeout(() => { this.teardown(); this.retry(); }, DEAD_AFTER_MS);
  }

  private retry(): void {
    if (this.stopped) return;
    const inMs = backoffMs(this.attempt, this.options.random ?? Math.random);
    this.attempt += 1;
    this.options.onStatus({ kind: 'retrying', inMs });
    this.timers.retryTimer = setTimeout(() => {
      this.timers.retryTimer = null;
      if (!this.stopped) this.connect();
    }, inMs);
  }

  /** Let go of the current socket and stop hearing from it. */
  private teardown(): void {
    this.joined = false;
    this.live = false;
    this.clearTimer('openTimer');
    this.clearTimer('pingTimer');
    this.clearTimer('deadTimer');
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }

  private clearTimer(name: TimerName): void {
    const timer = this.timers[name];
    if (timer === null) return;
    clearInterval(timer);
    clearTimeout(timer);
    this.timers[name] = null;
  }
}
