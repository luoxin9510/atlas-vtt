// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GmMessage, PlayerMessage } from '../../../src/app/online/protocol/index.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { Session } from '../../../apps/play/src/app/session.ts';
import type { SocketLike } from '../../../apps/play/src/net/TableSocket.ts';
import { TokenDrags } from '../../../apps/play/src/scene/TokenDrags.ts';
import type { TokenLayer } from '../../../apps/play/src/scene/TokenLayer.ts';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import { createTableStore, type TableStoreApi } from '../../../apps/play/src/state/tableStore.ts';
import { PauseBanner } from '../../../apps/play/src/ui/PauseBanner.tsx';

initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');

const MAP = { hash: 'a'.repeat(64), size: 10, type: 'image/png' };
const token = (id: string): SharedToken => ({ id, x: 100, y: 100, size: 60, cells: 1, rotation: 0, art: null, name: id, ring: null }) as SharedToken;
const pause = (paused: boolean): GmMessage => ({ t: 'pause', paused }) as GmMessage;

function load(store: TableStoreApi): void {
  store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP, lit: false } } as unknown as GmMessage, 0);
  store.applyMessage({ t: 'tokens', scene: 's1', tokens: [token('a')], cell: 70, snap: null }, 0);
  store.applyMessage({ t: 'mine', scene: 's1', tokens: ['a'] }, 0);
}

afterEach(cleanup);

describe('pause state', () => {
  it('is set and cleared by pause messages, with or without a scene', () => {
    const store = createTableStore();
    expect(store.getState().paused).toBe(false);
    store.applyMessage(pause(true), 0);
    expect(store.getState().paused).toBe(true);
    load(store);
    expect(store.getState().paused).toBe(true);
    store.applyMessage(pause(false), 0);
    expect(store.getState().paused).toBe(false);
  });
});

describe('PauseBanner', () => {
  it('shows the notice while paused and not otherwise', () => {
    const store = createTableStore();
    render(<PauseBanner store={store} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => store.applyMessage(pause(true), 0));
    expect(screen.getByRole('status').textContent).toBe('Game paused');
    act(() => store.applyMessage(pause(false), 0));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('TokenDrags while paused', () => {
  let sent: PlayerMessage[];
  let previews: number;
  beforeEach(() => { sent = []; previews = 0; });
  const make = (store: TableStoreApi): TokenDrags => new TokenDrags({
    store, send: (body) => { sent.push(body); return true; }, toWorld: (x, y) => ({ x, y }), shown: () => true,
    tokens: { sync: () => { previews++; } } as unknown as TokenLayer,
  });

  it('cancels a running drag and clears the preview when the pause begins', () => {
    const store = createTableStore();
    load(store);
    const drags = make(store);
    drags.handle({ kind: 'drag-token', id: 'a' });
    drags.handle({ kind: 'drag-move', id: 'a', x: 150, y: 100 });
    const before = previews;
    act(() => store.applyMessage(pause(true), 0));
    expect(sent.filter((m) => m.t === 'drag-cancel')).toHaveLength(1);
    expect(previews).toBeGreaterThan(before);
    drags.destroy();
  });

  it('sends nothing for a drag-token gesture while paused', () => {
    const store = createTableStore();
    load(store);
    store.applyMessage(pause(true), 0);
    const drags = make(store);
    drags.handle({ kind: 'drag-token', id: 'a' });
    drags.handle({ kind: 'drag-move', id: 'a', x: 150, y: 100 });
    drags.handle({ kind: 'drag-end', id: 'a', x: 150, y: 100 });
    expect(sent).toEqual([]);
    drags.destroy();
  });
});

describe('Session pause reset', () => {
  it('clears a stale pause on a new welcome', () => {
    vi.useFakeTimers();
    const sockets: Array<{ onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; sent: string[] }> = [];
    const session = new Session({
      origin: 'https://table.example', code: 'abcdefghijklmnopqrstuvwxyz'.replace(/./g, (_c, i) => 'abcdefghijklmnopqrstuvwxyz234567'[i]!), indexedDB: null,
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as unknown as Storage,
      open: () => { const s = { sent: [] as string[], readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send(d: string) { this.sent.push(d); }, close() {} }; sockets.push(s as never); return s as unknown as SocketLike; },
    });
    session.join({ name: 'Ann', code: '123456' });
    const welcome = { v: 1, t: 'welcome', role: 'player', id: 'p1', key: 'k'.repeat(24), gmOnline: true };
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.({ data: JSON.stringify(welcome) });
    session.store.applyMessage(pause(true), 0);
    expect(session.store.getState().paused).toBe(true);
    sockets[0]!.onmessage?.({ data: JSON.stringify(welcome) });
    expect(session.store.getState().paused).toBe(false);
    vi.useRealTimers();
  });
});
