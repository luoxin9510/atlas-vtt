import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { Session, tableCodeOf } from '../../../apps/play/src/app/session.ts';
import { seatStore } from '../../../apps/play/src/net/seatStore.ts';
import type { SocketLike } from '../../../apps/play/src/net/TableSocket.ts';

const CODE = 'abcdefghijklmnopqrstuvwxyz'.replace(/[018-9]/g, '').slice(0, 26).replace(/./g, (c, i) => 'abcdefghijklmnopqrstuvwxyz234567'[i]!);
const KEY = 'k'.repeat(24);

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
  receive(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }); }
  hello(): Record<string, unknown> { return JSON.parse(this.sent[0]!) as Record<string, unknown>; }
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
}

function setup(storage: Storage = memoryStorage()): { session: Session; sockets: FakeSocket[]; storage: Storage } {
  const sockets: FakeSocket[] = [];
  const session = new Session({
    origin: 'https://table.example', code: CODE, storage, indexedDB: null,
    open: () => { const s = new FakeSocket(); sockets.push(s); return s as unknown as SocketLike; },
  });
  return { session, sockets, storage };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('tableCodeOf', () => {
  it('reads 26 valid characters after #', () => {
    expect(CODE).toHaveLength(26);
    expect(tableCodeOf(`#${CODE}`)).toBe(CODE);
  });
  it('rejects uppercase, a short code and a missing #', () => {
    expect(tableCodeOf(`#${CODE.toUpperCase()}`)).toBeNull();
    expect(tableCodeOf(`#${CODE.slice(1)}`)).toBeNull();
    expect(tableCodeOf(CODE)).toBeNull();
    expect(tableCodeOf('')).toBeNull();
  });
});

describe('Session', () => {
  it('starts on the form when no seat is saved, and joins with the code typed', () => {
    const { session, sockets } = setup();
    expect(session.view.getState().screen).toBe('form');
    expect(sockets).toHaveLength(0);
    session.join({ name: 'Ann', code: '123456' });
    sockets[0]!.onopen?.();
    expect(sockets[0]!.hello()).toMatchObject({ role: 'player', name: 'Ann', code: '123456' });
    expect(session.view.getState().screen).toBe('table');
  });

  it('joins at once with a saved key and shows the name', () => {
    const storage = memoryStorage();
    seatStore(storage).write(CODE, { id: 'p1', key: KEY, name: 'Ann' });
    const { session, sockets } = setup(storage);
    sockets[0]!.onopen?.();
    expect(sockets[0]!.hello()).toMatchObject({ name: 'Ann', key: KEY });
    expect(session.view.getState()).toMatchObject({ screen: 'table', name: 'Ann' });
  });

  it('writes the seat on welcome and the own code on your-code', () => {
    const { session, sockets, storage } = setup();
    session.join({ name: 'Ann', code: '123456' });
    sockets[0]!.onopen?.();
    sockets[0]!.receive({ v: 1, t: 'welcome', role: 'player', id: 'p1', key: KEY, gmOnline: true });
    expect(seatStore(storage).read(CODE)).toEqual({ id: 'p1', key: KEY, name: 'Ann' });
    sockets[0]!.receive({ v: 1, t: 'game', body: { t: 'your-code', code: '654321', first: true } });
    expect(session.store.getState().ownCode).toBe('654321');
    expect(seatStore(storage).ownCode(CODE)).toBe('654321');
  });

  it('forgets a refused saved key and returns to the form with the reason', () => {
    const storage = memoryStorage();
    seatStore(storage).write(CODE, { id: 'p1', key: KEY, name: 'Ann' });
    const { session, sockets } = setup(storage);
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.({ code: CLOSE.wrongCode });
    expect(seatStore(storage).read(CODE)).toBeNull();
    expect(session.view.getState()).toEqual({ screen: 'form', reason: 'onlinePlay.close.wrongCode', name: 'Ann' });
    expect(sockets).toHaveLength(1);
  });

  it('forgets the seat of a player who joined by code when they are later kicked', () => {
    const { session, sockets, storage } = setup();
    session.join({ name: 'Ann', code: '123456' });
    sockets[0]!.onopen?.();
    sockets[0]!.receive({ v: 1, t: 'welcome', role: 'player', id: 'p1', key: KEY, gmOnline: true });
    sockets[0]!.onclose?.({ code: CLOSE.kicked });
    expect(seatStore(storage).read(CODE)).toBeNull();
    expect(session.view.getState()).toEqual({ screen: 'form', reason: 'onlinePlay.close.kicked', name: 'Ann' });
  });

  it('keeps the refusal on the table screen when no key was sent', () => {
    const { session, sockets } = setup();
    session.join({ name: 'Ann', code: '123456' });
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.({ code: CLOSE.paused });
    expect(session.store.getState().status).toEqual({ kind: 'refused', code: CLOSE.paused });
    expect(session.view.getState().screen).toBe('table');
    session.backToForm();
    expect(session.view.getState()).toEqual({ screen: 'form', reason: null, name: 'Ann' });
  });

  it('sends nothing before the player has joined', () => {
    const { session } = setup();
    expect(session.send({ t: 'resync', scene: 's', of: 'tokens' })).toBe(false);
  });

  const asset = { hash: 'a'.repeat(64), size: 10, mime: 'image/png' };
  const requests = (socket: FakeSocket): number => socket.sent.filter((s) => s.includes('asset-request')).length;

  it('stops asking for assets while retrying, and asks again for the same asset when the table is back', async () => {
    const { session, sockets } = setup();
    session.join({ name: 'Ann', code: '123456' });
    sockets[0]!.onopen?.();
    sockets[0]!.receive({ v: 1, t: 'welcome', role: 'player', id: 'p1', key: KEY, gmOnline: true });
    const first = session.assets.load(asset, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests(sockets[0]!)).toBe(1);
    sockets[0]!.onclose?.({ code: 1006 });
    expect(await first).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests(sockets[0]!)).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    sockets[1]!.onopen?.();
    sockets[1]!.receive({ v: 1, t: 'welcome', role: 'player', id: 'p1', key: KEY, gmOnline: true });
    void session.assets.load(asset, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests(sockets[1]!)).toBe(1);
  });

  it('does not ask for assets while the GM is away', async () => {
    const { session, sockets } = setup();
    session.join({ name: 'Ann', code: '123456' });
    sockets[0]!.onopen?.();
    sockets[0]!.receive({ v: 1, t: 'welcome', role: 'player', id: 'p1', key: KEY, gmOnline: false });
    expect(await session.assets.load(asset, null)).toBeNull();
    expect(requests(sockets[0]!)).toBe(0);
  });

  it('leaving for another join leaves one live socket, one ticker, no downloads and an empty log', async () => {
    const { session, sockets } = setup();
    session.join({ name: 'Ann', code: '123456' });
    sockets[0]!.onopen?.();
    sockets[0]!.receive({ v: 1, t: 'welcome', role: 'player', id: 'p1', key: KEY, gmOnline: true });
    sockets[0]!.receive({ v: 1, t: 'game', body: { t: 'people', people: [{ id: 'b'.repeat(20), name: 'Bo' }] } });
    expect(session.log.snapshot().people).toHaveLength(1);
    const pending = session.assets.load(asset, null);
    await vi.advanceTimersByTimeAsync(0);
    session.join({ name: 'Ann', key: KEY });
    expect(sockets[0]!.closed).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.closed).toBe(false);
    expect(await pending).toBeNull();
    expect(session.log.snapshot()).toEqual({ entries: [], unread: 0, refusal: null, people: [] });
    expect(vi.getTimerCount()).toBe(1);
    session.backToForm();
    expect(sockets[1]!.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forgets the seat when the relay says no access or superseded after a key was sent', () => {
    for (const code of [CLOSE.noAccess, CLOSE.superseded]) {
      const storage = memoryStorage();
      seatStore(storage).write(CODE, { id: 'p1', key: KEY, name: 'Ann' });
      const { session, sockets } = setup(storage);
      sockets[0]!.onopen?.();
      sockets[0]!.onclose?.({ code });
      expect(seatStore(storage).read(CODE)).toBeNull();
      expect(session.view.getState().screen).toBe('form');
    }
  });
});
