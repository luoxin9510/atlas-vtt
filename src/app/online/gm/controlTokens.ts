import type { App } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { activeStore, sceneStoreOf, selectedTokenIds, workScene, type WorkScene } from './atlasView.ts';
import { CAMPAIGNS_LOADING_TEXT, NO_TABLE_TEXT } from './campaignSeats.ts';
import type { OnlineTable } from './OnlineTable.ts';
import type { Ownership } from './ownership.ts';
import { giveTokens, markTokens } from './playerTokenRows.ts';
import type { TableCampaigns } from './tableCampaigns.ts';

/** What the token functions of the control read: the players' books, the campaigns, Atlas, and the running table (null: none). */
export interface TokenPorts {
  readonly ownership: Ownership;
  readonly campaigns: TableCampaigns;
  readonly app: App;
  current(): OnlineTable | null;
}

/** The scene players see (of the active Atlas tab while none is shared). */
export function sharedScene(ports: TokenPorts): WorkScene | null {
  return workScene(ports.current()?.sharedStore ?? activeStore(ports.app));
}

/** The scene of the active Atlas tab (the shared one when none is active). */
export function activeScene(ports: TokenPorts): WorkScene | null {
  const shared = ports.current()?.sharedTab;
  return workScene(activeStore(ports.app) ?? (shared === null || shared === undefined ? null : sceneStoreOf(shared)));
}

/** The tokens selected on the active Atlas tab (the shared one when none is active). */
export function selectedTokens(ports: TokenPorts): string[] {
  const scene = activeScene(ports);
  return scene === null ? [] : selectedTokenIds(scene.store.getState());
}

/** Whether player tokens can be kept now; where not, the GM is told why. Player tokens are the campaign's, so none are kept while no table plays one. */
function canMark(ports: TokenPorts): boolean {
  if (ports.ownership.canMark()) return true;
  showNotice(ports.campaigns.playing() === null ? NO_TABLE_TEXT : CAMPAIGNS_LOADING_TEXT);
  return false;
}

/** Makes tokens of the shared scene player tokens, or the GM's own (which takes them back from their players). */
export function markPlayerTokens(ports: TokenPorts, tokenIds: readonly string[], player: boolean): void {
  if (canMark(ports)) markTokens(ports.ownership, sharedScene(ports), tokenIds, player);
}

/** Makes the tokens selected on the active Atlas tab player tokens, or the GM's own; the number of tokens changed, null where no campaign keeps them. */
export function markSelected(ports: TokenPorts, player: boolean): number | null {
  const scene = activeScene(ports);
  const selected = scene === null ? [] : selectedTokenIds(scene.store.getState());
  if (selected.length > 0 && !canMark(ports)) return null;
  markTokens(ports.ownership, scene, selected, player);
  return selected.length;
}

/** Gives tokens of the shared scene to a player, or takes them back from whoever has them (null). */
export function giveSharedTokens(ports: TokenPorts, tokenIds: readonly string[], playerId: string | null): void {
  giveTokens(ports.ownership, sharedScene(ports), tokenIds, playerId);
}
