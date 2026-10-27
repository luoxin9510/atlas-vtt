import { DeltaReader, parseGmMessage, parseYourCode, type GmMessage, type PlayerMessage, type YourCodeMessage } from '../../../../src/app/online/protocol/index.ts';
import { PartAssembler } from './PartAssembler.ts';

export interface FeedPorts {
  send(body: PlayerMessage): void;
  apply(message: GmMessage): void;
  yourCode(message: YourCodeMessage): void;
  now(): number;
}

/** A player asks again for the same sequenced message no sooner than this. */
export const RESYNC_INTERVAL_MS = 1000;

/** What the GM says, in order: `part`s put together, deltas turned into whole messages, a gap answered with a `resync`. */
export class GameFeed {
  private reader = new DeltaReader();
  private assembler: PartAssembler;
  private readonly asked = new Map<string, number>();

  constructor(private readonly ports: FeedPorts) {
    this.assembler = new PartAssembler(ports.now);
  }

  receive(body: unknown): void {
    this.handle(body, true);
  }

  /** After a reconnect: what was held may be stale, so the next delta is a gap and asks for the whole message. */
  reset(): void {
    this.reader = new DeltaReader();
    this.assembler = new PartAssembler(this.ports.now);
    this.asked.clear();
  }

  private handle(body: unknown, partsAllowed: boolean): void {
    const code = parseYourCode(body);
    if (code !== null) {
      this.ports.yourCode(code);
      return;
    }
    const message = parseGmMessage(body);
    if (message === null) return;
    if (message.t === 'part') {
      if (!partsAllowed) return;
      const whole = this.assembler.take(message);
      if (whole !== null) this.handle(whole, false);
      return;
    }
    if (message.t !== 'tokens' && message.t !== 'fog' && message.t !== 'sight' && message.t !== 'delta') {
      this.ports.apply(message);
      return;
    }
    const read = this.reader.read(message);
    if (read === null) return;
    if (read !== 'gap') {
      this.ports.apply(read);
      return;
    }
    if (message.t === 'delta') this.resync(message.scene, message.of);
  }

  private resync(scene: string, of: 'tokens' | 'fog' | 'sight'): void {
    const now = this.ports.now();
    const key = `${scene}:${of}`;
    const last = this.asked.get(key);
    if (last !== undefined && now - last < RESYNC_INTERVAL_MS) return;
    this.asked.set(key, now);
    this.ports.send({ t: 'resync', scene, of });
  }
}
