import type { Timers } from '../companionTimers.ts';

interface Attempts {
  readonly stamp: string;
  readonly count: number;
}

/**
 * Notes whose copy could not be made, by the state of their source: the same state is not read again at
 * once. A failure that may pass (a read refused while a sync tool holds the file) is retried after each of
 * `delays`, then left until the note changes; one that cannot (a copy too large) is never retried.
 */
export class FailedReads {
  private readonly stamps = new Map<string, string>();
  private readonly timers = new Map<string, number>();
  private readonly attempts = new Map<string, Attempts>();

  constructor(
    private readonly clock: Timers,
    private readonly retry: (path: string) => void,
    private readonly delays: readonly number[] = [2_000, 10_000, 60_000],
  ) {}

  /** Whether `path` failed in this very state and is not due a retry yet. */
  skip(path: string, stamp: string): boolean {
    return this.stamps.get(path) === stamp;
  }

  /** The note failed in the state `stamp`; a transient failure schedules a retry while attempts remain. */
  mark(path: string, stamp: string, transient: boolean): void {
    this.cancel(path);
    this.stamps.set(path, stamp);
    const count = this.attempts.get(path)?.stamp === stamp ? (this.attempts.get(path)?.count ?? 0) : 0;
    this.attempts.set(path, { stamp, count });
    const delay = this.delays[count];
    if (!transient || delay === undefined) return;
    this.attempts.set(path, { stamp, count: count + 1 });
    this.timers.set(path, this.clock.setTimer(() => {
      this.timers.delete(path);
      this.stamps.delete(path);
      this.retry(path);
    }, delay));
  }

  /** The note changed, left the set or was deleted: nothing is remembered of it. */
  clear(path: string): void {
    this.cancel(path);
    this.stamps.delete(path);
    this.attempts.delete(path);
  }

  /** Forgets every note not in `keep`. */
  retain(keep: ReadonlySet<string>): void {
    for (const path of this.known()) if (!keep.has(path)) this.clear(path);
  }

  clearAll(): void {
    for (const path of this.known()) this.clear(path);
  }

  private known(): string[] {
    return [...new Set([...this.stamps.keys(), ...this.timers.keys(), ...this.attempts.keys()])];
  }

  private cancel(path: string): void {
    const timer = this.timers.get(path);
    if (timer !== undefined) this.clock.clearTimer(timer);
    this.timers.delete(path);
  }
}
