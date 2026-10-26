import { randomBytes } from 'node:crypto';
import { CLOSE, MAX_WAITING, type PlayerHello } from '../../../src/app/online/protocol/relay.ts';
import type { CampaignSeat } from '../../../src/app/online/protocol/seat.ts';
import type { RelayTiming } from './config.ts';
import { sameText } from './limits.ts';

export type GateDecision =
  | { readonly kind: 'welcome'; readonly id: string; readonly key: string }
  | { readonly kind: 'knock'; readonly id: string }
  | { readonly kind: 'close'; readonly code: number }
  | { readonly kind: 'pause'; readonly until: number };

/** What the gate needs to know of a table to decide on one hello. */
export interface GateView {
  readonly gate: { readonly code: string | null; readonly ask: boolean };
  /** Whether a GM has told this relay process the gate yet; until then nobody new can be let in. */
  readonly gateKnown: boolean;
  readonly roster: readonly CampaignSeat[];
  readonly maxPlayers: number;
  /** The players connected now, by id. */
  readonly connected: { has(id: string): boolean; readonly size: number };
  /** Knocks waiting for the GM. */
  readonly waiting: number;
  /** The id of the player this key belongs to, or null. */
  idForKey(key: string): string | null;
}

const WRONG_CODES_BEFORE_PAUSE = 5;
/**
 * Each consecutive pause is twice the one before, up to this many times the first (6 hours with the
 * default 10 minutes): five guesses per pause then cost an attacker next to nothing a day. The
 * escalation starts over once a day has passed since the last pause ended.
 */
const MAX_PAUSE_FACTOR = 36;
const ESCALATION_RESET_MS = 24 * 3_600_000;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A player id: 20 lowercase base32 characters. */
export function newPlayerId(): string {
  return Array.from(randomBytes(20), (byte) => BASE32[byte & 31]).join('');
}

/** A player key: 256 random bits, base64url. */
export function newPlayerKey(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * One table's join gate: who comes in, who knocks, who is turned away. It keeps only the wrong-code
 * count; the clock is passed in, and so is everything else about the table.
 */
export class JoinGate {
  readonly #timing: Pick<RelayTiming, 'wrongCodeWindowMs' | 'wrongCodePauseMs'>;
  #wrong: number[] = [];
  #pausedUntil = 0;
  /** How many pauses came in a row, and when the last one ran out. */
  #level = 0;
  #lastPauseEnd = 0;

  constructor(timing: Pick<RelayTiming, 'wrongCodeWindowMs' | 'wrongCodePauseMs'>) {
    this.#timing = timing;
  }

  /** When the gate is paused: until when; otherwise null. */
  pausedUntil(now: number): number | null {
    return this.#pausedUntil > now ? this.#pausedUntil : null;
  }

  /**
   * The GM changed the code: the pause ends at once and the count of wrong codes starts over, but the
   * escalation level stays, so an attacker's next pause is as long as it would have been.
   */
  endPause(): void {
    this.#pausedUntil = 0;
    this.#wrong = [];
  }

  decide(hello: PlayerHello, table: GateView, now: number): GateDecision {
    const full = (id: string): boolean => !table.connected.has(id) && table.connected.size >= table.maxPlayers;
    // A key is 256 bits that cannot be guessed, so it passes the gate (and its pause).
    const keyed = hello.key === undefined ? null : table.idForKey(hello.key);
    if (hello.key !== undefined && keyed !== null) return full(keyed) ? { kind: 'close', code: CLOSE.full } : { kind: 'welcome', id: keyed, key: hello.key };
    if (this.#pausedUntil !== 0 && now >= this.#pausedUntil) {
      this.#pausedUntil = 0;
      this.#wrong = [];
    }
    if (this.#pausedUntil !== 0) return { kind: 'pause', until: this.#pausedUntil };
    const given = hello.code;
    const seat = given === undefined ? undefined : table.roster.find((candidate) => sameText(candidate.code, given));
    if (seat !== undefined) return full(seat.id) ? { kind: 'close', code: CLOSE.full } : { kind: 'welcome', id: seat.id, key: newPlayerKey() };
    // No GM has set the gate since this relay started (the join code is never saved): nobody new waits on a GM who is not there.
    if (!table.gateKnown) return { kind: 'close', code: CLOSE.noAnswer };
    const required = table.gate.code;
    // A code that is neither a seat's nor the gate's is a guess, whether or not the GM asks for a code: it counts, and its answer is the same.
    if (given !== undefined && (required === null || !sameText(required, given))) return this.#wrongCode(now);
    if (required !== null && given === undefined) return { kind: 'close', code: CLOSE.wrongCode };
    if (table.connected.size >= table.maxPlayers) return { kind: 'close', code: CLOSE.full };
    if (!table.gate.ask) return { kind: 'welcome', id: newPlayerId(), key: newPlayerKey() };
    if (table.waiting >= MAX_WAITING) return { kind: 'close', code: CLOSE.tooManyKnocks };
    return { kind: 'knock', id: newPlayerId() };
  }

  #wrongCode(now: number): GateDecision {
    this.#wrong = this.#wrong.filter((at) => now - at < this.#timing.wrongCodeWindowMs);
    this.#wrong.push(now);
    if (this.#wrong.length < WRONG_CODES_BEFORE_PAUSE) return { kind: 'close', code: CLOSE.wrongCode };
    if (now - this.#lastPauseEnd >= ESCALATION_RESET_MS) this.#level = 0;
    const pause = Math.min(this.#timing.wrongCodePauseMs * 2 ** this.#level, this.#timing.wrongCodePauseMs * MAX_PAUSE_FACTOR);
    this.#level = Math.min(this.#level + 1, 6);
    this.#pausedUntil = now + pause;
    this.#lastPauseEnd = this.#pausedUntil;
    this.#wrong = [];
    return { kind: 'pause', until: this.#pausedUntil };
  }
}
