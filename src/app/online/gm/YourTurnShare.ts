import { YOUR_TURN_LEVEL } from '../protocol/fork.ts';
import type { GmMessage } from '../protocol/index.ts';

export interface YourTurnPorts {
  /** The owner of a token of the GM's scene, by its GM id. */
  ownerOf(tokenId: string): string | null | undefined;
  /** The fork level a player's app declared; 0 when none. */
  levelOf(player: string): number;
  send(body: GmMessage, to: string): void;
}

/**
 * Tells a player their token has just been given the turn: `your-turn` to the owner of each token
 * that joins the turn set, and only when the app declared a level that reads it. Nothing is sent
 * for a set that merely goes out again (resync, reconnect, full-list resend), nor for the first set
 * of a scene.
 */
export class YourTurnShare {
  private readonly ports: YourTurnPorts;
  private scene: string | null = null;
  private held: ReadonlySet<string> = new Set();

  constructor(ports: YourTurnPorts) {
    this.ports = ports;
  }

  /** The GM ids of the tokens holding the turn in `scene` now. */
  update(scene: string, turnTokens: ReadonlySet<string>): void {
    const before = this.scene === scene ? this.held : null;
    this.scene = scene;
    this.held = new Set(turnTokens);
    if (before === null) return;
    const told = new Set<string>();
    for (const tokenId of turnTokens) {
      if (before.has(tokenId)) continue;
      const owner = this.ports.ownerOf(tokenId);
      if (owner === undefined || owner === null || told.has(owner) || this.ports.levelOf(owner) < YOUR_TURN_LEVEL) continue;
      told.add(owner);
      this.ports.send({ t: 'your-turn', scene }, owner);
    }
  }

  /** The table restarts or its scene is withdrawn: the next set is a first one. */
  reset(): void {
    this.scene = null;
    this.held = new Set();
  }
}
