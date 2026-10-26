import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { RelayConfig } from './config.ts';
import { sha256Hex } from './persist.ts';

const WRONG_KEYS_BEFORE_LOCK = 5;
const LOCK_MS = 10 * 60_000;
const TABLES_PER_MINUTE = 10;
const MINUTE_MS = 60_000;

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Who is asking: the TCP peer, unless a trusted proxy header says otherwise. */
export function clientAddress(req: IncomingMessage, trust: RelayConfig['trustProxy']): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  if (trust === 'xff') {
    // The last entry is the one our own proxy appended; earlier ones can be forged by the client.
    const last = firstHeader(req.headers['x-forwarded-for'])?.split(',').at(-1)?.trim();
    return last ? last : peer;
  }
  if (trust === 'cf') {
    const address = firstHeader(req.headers['cf-connecting-ip'])?.trim();
    return address ? address : peer;
  }
  return peer;
}

/** Compares two secrets in constant time (by their digests, so lengths do not leak). */
export function sameText(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256Hex(a)), Buffer.from(sha256Hex(b)));
}

/** Per client address: 5 wrong host keys lock `POST /api/tables` for 10 minutes. */
export class HostKeyLock {
  readonly #wrong = new Map<string, number>();
  readonly #lockedUntil = new Map<string, number>();

  isLocked(address: string, now: number = Date.now()): boolean {
    const until = this.#lockedUntil.get(address);
    if (until === undefined) return false;
    if (now < until) return true;
    this.#lockedUntil.delete(address);
    this.#wrong.delete(address);
    return false;
  }

  failed(address: string, now: number = Date.now()): void {
    const count = (this.#wrong.get(address) ?? 0) + 1;
    this.#wrong.set(address, count);
    if (count >= WRONG_KEYS_BEFORE_LOCK) this.#lockedUntil.set(address, now + LOCK_MS);
  }

  succeeded(address: string): void {
    this.#wrong.delete(address);
  }
}

/** Per client address: at most 10 `POST /api/tables` in any minute. */
export class TableRateLimit {
  readonly #hits = new Map<string, number[]>();

  /** Counts one request; false when this address is over its minute. */
  allow(address: string, now: number = Date.now()): boolean {
    const recent = (this.#hits.get(address) ?? []).filter((at) => now - at < MINUTE_MS);
    if (recent.length >= TABLES_PER_MINUTE) {
      this.#hits.set(address, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(address, recent);
    return true;
  }
}

const NEWCOMERS_PER_WINDOW = 10;
const NEWCOMER_WINDOW_MS = 10 * MINUTE_MS;

/** Per client address: at most 10 new players (admitted or knocking) in 10 minutes. */
export class NewcomerLimit {
  readonly #hits = new Map<string, number[]>();

  /** Counts one newcomer; false when this address has had its ten. */
  allow(address: string, now: number = Date.now()): boolean {
    const recent = (this.#hits.get(address) ?? []).filter((at) => now - at < NEWCOMER_WINDOW_MS);
    if (recent.length >= NEWCOMERS_PER_WINDOW) {
      this.#hits.set(address, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(address, recent);
    return true;
  }
}

/** Sockets one client address may hold open at once, GM and players together. */
export const MAX_SOCKETS_PER_ADDRESS = 20;

export class SocketCap {
  readonly #open = new Map<string, number>();

  /** Counts one more socket; false when the address is at its limit. */
  acquire(address: string): boolean {
    const count = this.#open.get(address) ?? 0;
    if (count >= MAX_SOCKETS_PER_ADDRESS) return false;
    this.#open.set(address, count + 1);
    return true;
  }

  release(address: string): void {
    const count = (this.#open.get(address) ?? 0) - 1;
    if (count > 0) this.#open.set(address, count);
    else this.#open.delete(address);
  }
}
