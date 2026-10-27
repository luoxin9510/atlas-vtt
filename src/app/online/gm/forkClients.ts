import type { PlayerClient } from '../protocol/fork.ts';

/** The fork level each connected player's app declared (`client`); a player who declared none has 0. */
export class ForkClients {
  private readonly levels = new Map<string, number>();

  record(player: string, message: PlayerClient): void {
    this.levels.set(player, message.forkLevel);
  }

  levelOf(player: string): number {
    return this.levels.get(player) ?? 0;
  }

  forget(player: string): void {
    this.levels.delete(player);
  }
}
