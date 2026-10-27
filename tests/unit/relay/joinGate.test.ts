import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING } from '../../../apps/relay/src/config.ts';
import { type GateView, JoinGate } from '../../../apps/relay/src/joinGate.ts';
import { CLOSE, MAX_WAITING, PLAYER_ID_PATTERN, SECRET_PATTERN, type PlayerHello } from '../../../src/app/online/protocol/relay.ts';

const KNOWN_ID = 'k'.repeat(20);
const SEAT_ID = 's'.repeat(20);
const KNOWN_KEY = 'known-key-0123456789abcdef';
const NOW = 1_000_000;

function hello(extra: Partial<Omit<PlayerHello, 'v' | 't' | 'role'>> = {}): PlayerHello {
  return { v: 1, t: 'hello', role: 'player', name: 'Ann', ...extra };
}

function view(overrides: Partial<GateView> = {}): GateView {
  return {
    gate: { code: '123456', ask: false },
    gateKnown: true,
    roster: [{ id: SEAT_ID, name: 'Seat', code: '654321' }],
    maxPlayers: 8,
    connected: new Map(),
    waiting: 0,
    idForKey: (key) => (key === KNOWN_KEY ? KNOWN_ID : null),
    ...overrides,
  };
}

describe('JoinGate', () => {
  it('welcomes a known key with its id and keeps the key, whatever the gate says', () => {
    const gate = new JoinGate(DEFAULT_TIMING);
    expect(gate.decide(hello({ key: KNOWN_KEY }), view(), NOW)).toEqual({ kind: 'welcome', id: KNOWN_ID, key: KNOWN_KEY });
  });

  it('welcomes a roster seat code with the seat id and a fresh key', () => {
    const decision = new JoinGate(DEFAULT_TIMING).decide(hello({ code: '654321' }), view(), NOW);
    expect(decision).toMatchObject({ kind: 'welcome', id: SEAT_ID });
    if (decision.kind === 'welcome') expect(decision.key).toMatch(SECRET_PATTERN);
  });

  it('welcomes a newcomer with the right code and ask false under a new 20-character id', () => {
    const decision = new JoinGate(DEFAULT_TIMING).decide(hello({ code: '123456' }), view(), NOW);
    expect(decision.kind).toBe('welcome');
    if (decision.kind === 'welcome') {
      expect(decision.id).toMatch(PLAYER_ID_PATTERN);
      expect(decision.key).toMatch(SECRET_PATTERN);
    }
  });

  it('needs no code when the GM set none', () => {
    expect(new JoinGate(DEFAULT_TIMING).decide(hello(), view({ gate: { code: null, ask: false } }), NOW).kind).toBe('welcome');
  });

  it('knocks when the GM asks', () => {
    const decision = new JoinGate(DEFAULT_TIMING).decide(hello({ code: '123456' }), view({ gate: { code: '123456', ask: true } }), NOW);
    expect(decision.kind).toBe('knock');
    if (decision.kind === 'knock') expect(decision.id).toMatch(PLAYER_ID_PATTERN);
  });

  it('closes 4010 for a wrong code and for none', () => {
    const gate = new JoinGate(DEFAULT_TIMING);
    expect(gate.decide(hello({ code: '000000' }), view(), NOW)).toEqual({ kind: 'close', code: CLOSE.wrongCode });
    expect(gate.decide(hello(), view(), NOW)).toEqual({ kind: 'close', code: CLOSE.wrongCode });
  });

  it('pauses on the 5th wrong code within 10 minutes, until now + 600000, and stays paused', () => {
    const gate = new JoinGate(DEFAULT_TIMING);
    for (let attempt = 0; attempt < 4; attempt += 1) expect(gate.decide(hello({ code: '000000' }), view(), NOW + attempt).kind).toBe('close');
    expect(gate.decide(hello({ code: '000000' }), view(), NOW + 4)).toEqual({ kind: 'pause', until: NOW + 4 + 600_000 });
    expect(gate.decide(hello({ code: '123456' }), view(), NOW + 5_000)).toEqual({ kind: 'pause', until: NOW + 4 + 600_000 });
    expect(gate.decide(hello({ code: '654321' }), view(), NOW + 5_000).kind).toBe('pause');
    expect(gate.decide(hello({ key: KNOWN_KEY }), view(), NOW + 5_000).kind).toBe('welcome');
    expect(gate.decide(hello({ code: '123456' }), view(), NOW + 4 + 600_000).kind).toBe('welcome');
  });

  it('counts a code that matches no seat even when the GM set no join code, and answers 4010', () => {
    const gate = new JoinGate(DEFAULT_TIMING);
    const open = view({ gate: { code: null, ask: false } });
    for (let attempt = 0; attempt < 4; attempt += 1) expect(gate.decide(hello({ code: '111111' }), open, NOW)).toEqual({ kind: 'close', code: CLOSE.wrongCode });
    expect(gate.decide(hello({ code: '222222' }), open, NOW).kind).toBe('pause');
    expect(gate.decide(hello({ code: '654321' }), open, NOW + 1).kind).toBe('pause');
  });

  it('answers the same to a wrong code whether or not the GM asks', () => {
    const gate = new JoinGate(DEFAULT_TIMING);
    for (const ask of [true, false]) expect(gate.decide(hello({ code: '111111' }), view({ gate: { code: null, ask } }), NOW)).toEqual({ kind: 'close', code: CLOSE.wrongCode });
  });

  it('closes 4013 for a newcomer while the gate is unknown, but lets a key and a seat code in', () => {
    const gate = new JoinGate(DEFAULT_TIMING);
    const unknown = view({ gateKnown: false });
    expect(gate.decide(hello({ code: '123456' }), unknown, NOW)).toEqual({ kind: 'close', code: CLOSE.noAnswer });
    expect(gate.decide(hello(), unknown, NOW)).toEqual({ kind: 'close', code: CLOSE.noAnswer });
    expect(gate.decide(hello({ key: KNOWN_KEY }), unknown, NOW).kind).toBe('welcome');
    expect(gate.decide(hello({ code: '654321' }), unknown, NOW)).toMatchObject({ kind: 'welcome', id: SEAT_ID });
  });

  it('forgets wrong codes older than the window', () => {
    const gate = new JoinGate(DEFAULT_TIMING);
    for (let attempt = 0; attempt < 4; attempt += 1) gate.decide(hello({ code: '000000' }), view(), NOW);
    expect(gate.decide(hello({ code: '000000' }), view(), NOW + 600_001)).toEqual({ kind: 'close', code: CLOSE.wrongCode });
  });

  it('closes 4014 for the 9th waiting knock', () => {
    const ask = { code: '123456', ask: true };
    const gate = new JoinGate(DEFAULT_TIMING);
    expect(gate.decide(hello({ code: '123456' }), view({ gate: ask, waiting: MAX_WAITING - 1 }), NOW).kind).toBe('knock');
    expect(gate.decide(hello({ code: '123456' }), view({ gate: ask, waiting: MAX_WAITING }), NOW)).toEqual({ kind: 'close', code: CLOSE.tooManyKnocks });
  });

  it('closes 4003 for a full table, but lets a connected player come back on their key', () => {
    const connected = new Map<string, unknown>(Array.from({ length: 8 }, (_, index) => [index === 0 ? KNOWN_ID : `p${index}`.padEnd(20, 'a'), 1]));
    const full = view({ connected });
    const gate = new JoinGate(DEFAULT_TIMING);
    expect(gate.decide(hello({ code: '123456' }), full, NOW)).toEqual({ kind: 'close', code: CLOSE.full });
    expect(gate.decide(hello({ code: '654321' }), full, NOW)).toEqual({ kind: 'close', code: CLOSE.full });
    expect(gate.decide(hello({ key: KNOWN_KEY }), full, NOW).kind).toBe('welcome');
  });

  describe('a new gate code ends a pause (the GM\'s way out)', () => {
    it('ends the pause at once and keeps the escalation level, so the next pause is longer', () => {
      const gate = new JoinGate(DEFAULT_TIMING);
      for (let i = 0; i < 5; i += 1) gate.decide(hello({ code: '000000' }), view(), NOW + i);
      expect(gate.pausedUntil(NOW + 10)).not.toBeNull();
      gate.endPause();
      expect(gate.pausedUntil(NOW + 10)).toBeNull();
      expect(gate.decide(hello({ code: '123456' }), view(), NOW + 11).kind).toBe('welcome');
      for (let i = 0; i < 4; i += 1) gate.decide(hello({ code: '000000' }), view(), NOW + 20 + i);
      const next = gate.decide(hello({ code: '000000' }), view(), NOW + 30);
      expect(next).toEqual({ kind: 'pause', until: NOW + 30 + 1_200_000 });
    });
  });

  describe('escalating pause (seat codes cannot be ground down over weeks)', () => {
    /** Five wrong codes at `at`; returns the pause that the fifth starts. */
    function trip(gate: JoinGate, at: number): number {
      for (let i = 0; i < 4; i += 1) expect(gate.decide(hello({ code: '000000' }), view(), at + i).kind).toBe('close');
      const decision = gate.decide(hello({ code: '000000' }), view(), at + 4);
      if (decision.kind !== 'pause') throw new Error('expected a pause');
      return decision.until - (at + 4);
    }

    it('doubles each consecutive pause, up to 36 times the first (6 hours at the default)', () => {
      const gate = new JoinGate(DEFAULT_TIMING);
      let now = NOW;
      const lengths: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const length = trip(gate, now);
        lengths.push(length);
        now += length + 10;
      }
      expect(lengths).toEqual([600_000, 1_200_000, 2_400_000, 4_800_000, 9_600_000, 19_200_000, 21_600_000, 21_600_000]);
    });

    it('starts over after a day without a wrong code', () => {
      const gate = new JoinGate(DEFAULT_TIMING);
      let now = NOW;
      now += trip(gate, now) + 10;
      expect(trip(gate, now)).toBe(1_200_000);
      now += 1_200_000 + 24 * 3_600_000 + 10;
      expect(trip(gate, now)).toBe(600_000);
    });
  });
});
