import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../../src/app/i18n/locales/en/index.ts';
import { zh } from '../../../src/app/i18n/locales/zh/index.ts';
import { backoffMs } from '../../../apps/play/src/net/backoff.ts';
import { closeReasonKey, refusedKey } from '../../../apps/play/src/net/closeReasons.ts';
import { socketUrl, TableSocket, type JoinAs, type SocketLike, type SocketStatus } from '../../../apps/play/src/net/TableSocket.ts';

class FakeSocket {
  sent: string[] = [];
  closed = false;
  readyState = 1;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; }
  receive(frame: unknown): void { this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }); }
  serverClose(code: number): void { this.onclose?.({ code }); }
  frames(): Record<string, unknown>[] { return this.sent.filter((s) => s.startsWith('{')).map((s) => JSON.parse(s) as Record<string, unknown>); }
}

const KEY = 'k'.repeat(24);
const welcome = { v: 1, t: 'welcome', role: 'player', id: 'p1', key: KEY, gmOnline: true };

function setup(join: JoinAs = { name: 'Ann', key: KEY }): { sockets: FakeSocket[]; statuses: SocketStatus[]; games: unknown[]; seats: { id: string; key: string }[]; socket: TableSocket } {
  const sockets: FakeSocket[] = [];
  const statuses: SocketStatus[] = [];
  const games: unknown[] = [];
  const seats: { id: string; key: string }[] = [];
  const socket = new TableSocket({
    url: 'wss://x/api/tables/t/socket', join, random: () => 0,
    open: () => { const s = new FakeSocket(); sockets.push(s); return s as unknown as SocketLike; },
    onStatus: (s) => statuses.push(s), onGame: (b) => games.push(b), onSeat: (s) => seats.push(s),
  });
  socket.start();
  sockets[0]?.onopen?.();
  return { sockets, statuses, games, seats, socket };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('hello', () => {
  it('sends the key with waits', () => {
    const { sockets } = setup({ name: 'Ann', key: KEY });
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ v: 1, t: 'hello', role: 'player', name: 'Ann', key: KEY, waits: true });
  });
  it('sends the code', () => {
    const { sockets } = setup({ name: 'Ann', code: 'JOIN12' });
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ v: 1, t: 'hello', role: 'player', name: 'Ann', code: 'JOIN12', waits: true });
  });
  it('marks a newcomer without key and code', () => {
    const { sockets } = setup({ name: 'Ann' });
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ v: 1, t: 'hello', role: 'player', name: 'Ann', waits: true, newcomer: true });
  });
  it('keeps a waiting token and sends it as wait on the next try', () => {
    const { sockets } = setup({ name: 'Ann' });
    const wait = 'w'.repeat(20);
    sockets[0]!.receive({ v: 1, t: 'waiting', wait });
    sockets[0]!.serverClose(1006);
    vi.advanceTimersByTime(500);
    sockets[1]!.onopen?.();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({ wait, newcomer: true });
  });
});

describe('welcome', () => {
  it('reports the seat, joins, and sends the client message first', () => {
    const { sockets, statuses, seats, socket } = setup();
    sockets[0]!.receive(welcome);
    expect(seats).toEqual([{ id: 'p1', key: KEY }]);
    expect(statuses.at(-1)).toEqual({ kind: 'joined', id: 'p1', gmOnline: true });
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({ v: 1, t: 'send', body: { t: 'client', app: 'atlas-fork-play', forkLevel: 3 } });
    expect(socket.send({ t: 'x' })).toBe(true);
  });
  it('updates gmOnline and passes game bodies', () => {
    const { sockets, statuses, games } = setup();
    sockets[0]!.receive(welcome);
    sockets[0]!.receive({ v: 1, t: 'gm', online: false });
    expect(statuses.at(-1)).toEqual({ kind: 'joined', id: 'p1', gmOnline: false });
    sockets[0]!.receive({ v: 1, t: 'game', body: { t: 'hi' } });
    expect(games).toEqual([{ t: 'hi' }]);
  });
  it('says its fork level again whenever the GM comes (back) online, not when it goes away', () => {
    const { sockets } = setup();
    const clients = (): number => sockets[0]!.frames().filter((f) => (f.body as { t?: string } | undefined)?.t === 'client').length;
    sockets[0]!.receive({ v: 1, t: 'gm', online: true });
    expect(clients()).toBe(0);
    sockets[0]!.receive(welcome);
    expect(clients()).toBe(1);
    sockets[0]!.receive({ v: 1, t: 'gm', online: false });
    expect(clients()).toBe(1);
    sockets[0]!.receive({ v: 1, t: 'gm', online: true });
    expect(clients()).toBe(2);
    expect(JSON.parse(sockets[0]!.sent.at(-1)!)).toEqual({ v: 1, t: 'send', body: { t: 'client', app: 'atlas-fork-play', forkLevel: 3 } });
  });
  it('rejects send before joining and over 4 KiB', () => {
    const { sockets, socket } = setup();
    expect(socket.send({ t: 'x' })).toBe(false);
    sockets[0]!.receive(welcome);
    const before = sockets[0]!.sent.length;
    expect(socket.send({ t: 'x', text: 'a'.repeat(5 * 1024) })).toBe(false);
    expect(sockets[0]!.sent.length).toBe(before);
  });
  it('counts bytes, not characters', () => {
    const { sockets, socket } = setup();
    sockets[0]!.receive(welcome);
    expect(socket.send({ text: '汉'.repeat(1500) })).toBe(false);
  });
});

describe('keep-alive', () => {
  it('pings every 30 s', () => {
    const { sockets } = setup();
    sockets[0]!.receive(welcome);
    vi.advanceTimersByTime(30_000);
    sockets[0]!.receive('pong');
    vi.advanceTimersByTime(30_000);
    expect(sockets[0]!.sent.filter((s) => s === 'ping')).toHaveLength(2);
  });
  it('stays alive while pongs arrive', () => {
    const { sockets } = setup();
    sockets[0]!.receive(welcome);
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(5_000);
    sockets[0]!.receive('pong');
    vi.advanceTimersByTime(25_000);
    expect(sockets[0]!.closed).toBe(false);
    expect(sockets).toHaveLength(1);
  });
  it('reconnects after a silent socket', () => {
    const { sockets, statuses } = setup();
    sockets[0]!.receive(welcome);
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(20_000);
    expect(sockets[0]!.closed).toBe(true);
    expect(statuses.at(-1)).toEqual({ kind: 'retrying', inMs: 250 });
    vi.advanceTimersByTime(250);
    expect(sockets).toHaveLength(2);
  });
});

describe('closing', () => {
  it('refuses on a final code and opens no new socket', () => {
    const { sockets, statuses } = setup();
    sockets[0]!.serverClose(4010);
    expect(statuses.at(-1)).toEqual({ kind: 'refused', code: 4010 });
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
  });
  it('retries on 1006, backing off further each time until welcome', () => {
    const { sockets, statuses } = setup();
    sockets[0]!.serverClose(1006);
    expect(statuses.at(-1)).toEqual({ kind: 'retrying', inMs: 250 });
    vi.advanceTimersByTime(250);
    expect(sockets).toHaveLength(2);
    sockets[1]!.serverClose(1006);
    expect(statuses.at(-1)).toEqual({ kind: 'retrying', inMs: 500 });
  });
  it('stop closes and cancels the retry', () => {
    const { sockets, socket } = setup();
    sockets[0]!.serverClose(1006);
    socket.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
  it('rejoins with the key the welcome gave, not the code', () => {
    const { sockets } = setup({ name: 'Ann', code: 'JOIN12' });
    sockets[0]!.receive(welcome);
    sockets[0]!.serverClose(1006);
    vi.advanceTimersByTime(500);
    sockets[1]!.onopen?.();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({ key: KEY });
    expect(JSON.parse(sockets[1]!.sent[0]!)).not.toHaveProperty('code');
  });
});

describe('helpers', () => {
  it('backoff doubles to 30 s and is halved at most', () => {
    const low = [0, 1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, () => 0));
    const high = [0, 1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, () => 0.999999));
    expect(low).toEqual([250, 500, 1000, 2000, 4000, 8000, 15000]);
    expect(high).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000]);
  });
  it('forgets a refused key', () => {
    expect(refusedKey(4010, true)).toBe(true);
    expect(refusedKey(4009, true)).toBe(true);
    expect(refusedKey(4008, true)).toBe(true);
    expect(refusedKey(4015, true)).toBe(true);
    expect(refusedKey(4016, true)).toBe(true);
    expect(refusedKey(4015, false)).toBe(false);
    expect(refusedKey(4010, false)).toBe(false);
    expect(refusedKey(4012, true)).toBe(false);
  });
  it('socketUrl maps schemes', () => {
    expect(socketUrl('https://a.example', 'abc')).toBe('wss://a.example/api/tables/abc/socket');
    expect(socketUrl('http://localhost:8787', 'abc')).toBe('ws://localhost:8787/api/tables/abc/socket');
  });
  it('has a close message in en and zh for every code', () => {
    for (const code of [...Array.from({ length: 17 }, (_, i) => 4001 + i), 1006]) {
      const key = closeReasonKey(code);
      expect(en[key]).toBeDefined();
      expect(zh[key]).toBeDefined();
    }
    expect(closeReasonKey(4010)).toBe('onlinePlay.close.wrongCode');
    expect(closeReasonKey(1006)).toBe('onlinePlay.close.other');
  });
});
