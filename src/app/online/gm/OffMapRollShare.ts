import type { OffMapRollFeed } from '../../services/offMapRollFeed';
import { RollShare, type RollSharePorts } from './RollShare.ts';

/** What the share needs of the table: a roll made with no map open has no scene, so no token to name. */
export type OffMapRollSharePorts = Pick<RollSharePorts, 'send' | 'showGmRolls' | 'logged'>;

/**
 * The GM's rolls made with no map open, to the players and the log, as a map's rolls are
 * (`RollShare`): a GM-only roll leaves a secret entry, no name or step label travels, the two sides
 * of a contest stay one contest. It belongs to the table, not to a shared tab: it runs for as long
 * as the table does, so a roll shares once, whichever tab is shared. Rolls of a map's bus are
 * the tab's `RollShare`'s, and never reach here.
 */
export class OffMapRollShare {
  private readonly share: RollShare;
  private stopListening: (() => void) | null = null;

  /** `feed` is read at each start: the roller of the app, or null where there is none. */
  constructor(private readonly feed: () => OffMapRollFeed | null, ports: OffMapRollSharePorts) {
    this.share = new RollShare({ ...ports, scene: () => null, alias: (tokenId) => tokenId });
  }

  start(): void {
    this.stop();
    this.stopListening = this.feed()?.onRoll(({ result, origin }) => this.share.announce(result, origin)) ?? null;
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
  }
}
