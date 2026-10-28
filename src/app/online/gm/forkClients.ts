import type { PlayerClient } from '../protocol/fork.ts';
import { parsePlayerMessage } from '../protocol/index.ts';

/** The fork level each connected player's app declared (`client`); a player who declared none has 0. */
export class ForkClients {
  private readonly levels = new Map<string, number>();
  private readonly onClient: ((player: string, level: number) => void) | undefined;

  /** `onClient` hears each `client` message once its level is recorded. */
  constructor(onClient?: (player: string, level: number) => void) {
    this.onClient = onClient;
  }

  record(player: string, message: PlayerClient): void {
    this.levels.set(player, message.forkLevel);
  }

  /** A player's message: true when it is a `client` message (recorded, and nothing answers it), false for any other. */
  receive(player: string, body: unknown): boolean {
    const message = parsePlayerMessage(body);
    if (message?.t !== 'client') return false;
    this.record(player, message);
    this.onClient?.(player, message.forkLevel);
    return true;
  }

  levelOf(player: string): number {
    return this.levels.get(player) ?? 0;
  }

  forget(player: string): void {
    this.levels.delete(player);
  }
}
