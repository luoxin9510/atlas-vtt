import { PAUSE_LEVEL } from '../protocol/fork.ts';
import type { GmMessage } from '../protocol/index.ts';

export interface PausePorts {
  /** The players online now. */
  players(): readonly string[];
  /** The fork level a player's app declared; 0 when none. */
  levelOf(player: string): number;
  send(body: GmMessage, to: string): void;
}

/**
 * The GM's switch that stops players moving tokens. Players whose app speaks level 2 are told when it
 * changes, and again after each of their `client` messages (which is when their level is known: at a
 * join or reconnect it is not), so a player who comes back sees the state as it is, also when it is off.
 * Older apps are sent nothing: their moves are refused without a reason.
 */
export class PauseShare {
  private readonly ports: PausePorts;
  private on: boolean;

  constructor(ports: PausePorts, initial = false) {
    this.ports = ports;
    this.on = initial;
  }

  get paused(): boolean {
    return this.on;
  }

  /** Sets the switch; the players who can read it are told when its value changes. */
  set(paused: boolean): void {
    if (paused === this.on) return;
    this.on = paused;
    for (const player of this.ports.players()) this.client(player);
  }

  /** A player's app declared its level: it is told the current value when it can read it. */
  client(player: string): void {
    if (this.ports.levelOf(player) >= PAUSE_LEVEL) this.ports.send({ t: 'pause', paused: this.on }, player);
  }
}

/** The pause as the table shows it: a switch that also drops the drags in progress and tells the table's events. */
export interface TablePause {
  readonly paused: boolean;
  set(on: boolean): void;
}

/** Wraps the share as the table's `pause`: setting it to a new value also cancels drags and tells the table's events. */
export function tablePause(share: PauseShare, hooks: { cancelDrags(): void; paused(on: boolean): void; changed(): void }): TablePause {
  return {
    get paused(): boolean {
      return share.paused;
    },
    set: (on) => {
      if (on === share.paused) return;
      share.set(on);
      if (on) hooks.cancelDrags();
      hooks.paused(on);
      hooks.changed();
    },
  };
}
