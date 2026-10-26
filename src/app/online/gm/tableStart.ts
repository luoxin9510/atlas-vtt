import { showNotice } from '../../ui/notice';
import type { WorkspaceLeaf } from 'obsidian';
import { obsidianHttp } from './account/obsidianHttp.ts';
import { sceneStoreOf } from './atlasView.ts';
import { NO_SERVER_TEXT } from './account/accountView.ts';
import { CAMPAIGNS_LOADING_TEXT, campaignLink, linkRefusal, NO_CAMPAIGN_TEXT, type TableSeats } from './campaignSeats.ts';
import type { CreatedTable } from './createdTable.ts';
import { createTable } from './createTable.ts';
import { isSelfHosted, relayOrigin } from './servers.ts';
import { endStrayTable } from './strayTable.ts';
import type { TableCampaigns } from './tableCampaigns.ts';
import { t } from '../../i18n';

/** The GM's account as starting a table needs it. */
export interface HostAccount {
  /** The account's token (a self-hosted server's host key), or null while there is none. */
  token(): string | null;
  /** The relay refused the token. `selfHosted` says whether the server asked was a self-hosted one when the request was made (the setting may have changed since). */
  signedOutByServer(selfHosted?: boolean): void;
  /** Asks the relay again what the account may host. */
  refresh(force: boolean): Promise<void>;
}

export const NO_ACCOUNT: HostAccount = { token: () => null, signedOutByServer: () => undefined, refresh: () => Promise.resolve() };

/** Tells the GM why something cannot be done; null, for the caller to answer. */
export function refused(text: string): null {
  showNotice(text);
  return null;
}

export { NO_SERVER_TEXT };

/** What the GM reads where a self-hosted server is set and no host key is kept. */
export const NO_HOST_KEY_START_TEXT = t('onlineGm.start.noHostKey');

/** Why no table can start from the Atlas tab `leaf` for the campaign `campaignId` (null: none is played), or null where one can. */
export function startBlock(leaf: WorkspaceLeaf | null, campaignId: string | null, account: HostAccount): string | null {
  if (relayOrigin() === null) return NO_SERVER_TEXT;
  if (leaf === null || sceneStoreOf(leaf) === null) return t('onlineGm.start.noMapTab');
  if (campaignId === null) return NO_CAMPAIGN_TEXT;
  if (account.token() !== null) return null;
  return isSelfHosted() ? NO_HOST_KEY_START_TEXT : t('onlineGm.start.signIn');
}

/** A table the relay made on a campaign's link, with that campaign's players. */
export interface CampaignTable {
  readonly created: CreatedTable;
  readonly seats: TableSeats;
}

/** What the GM reads where the relay opened a table on another link than the campaign's (a relay from before lasting links). */
export const OTHER_LINK_TEXT = t('onlineGm.start.otherLink');

/**
 * Asks the server `origin` (the one set when the start began) for a table on the lasting link of the campaign `campaignId` once its players file
 * was read, making the link first where it has none; null where no table was made, the GM told why
 * (a relay that signed the account out says so on the account instead; one that needs a newer Atlas
 * names its least GM level to `outdated`). A table the relay opened on
 * another link is ended, never run: its players would not find it at the campaign's link.
 */
export async function createCampaignTable(campaigns: TableCampaigns, campaignId: string, token: string, origin: string, account: HostAccount, outdated: (minLevel: number) => void = () => undefined): Promise<CampaignTable | null> {
  // Which kind of server this is was decided when the request was made: the setting may change before the answer comes.
  const selfHosted = isSelfHosted();
  const seats = await campaigns.open(campaignId).catch(() => null);
  const link = seats === null ? null : campaignLink(seats);
  if (seats === null || link === null) return refused(seats === null ? CAMPAIGNS_LOADING_TEXT : linkRefusal(seats));
  // Whether this account may host is the relay's answer alone: nothing here looks at what the account was last said to hold.
  const created = await createTable(obsidianHttp, origin, token, link, selfHosted);
  if (!('message' in created) && created.code !== link) {
    endStrayTable(origin, created);
    return refused(OTHER_LINK_TEXT);
  }
  if (!('message' in created)) return { created, seats };
  if (created.minLevel !== undefined) outdated(created.minLevel);
  if (created.status === 401) account.signedOutByServer(selfHosted);
  else if (created.status === 403) void account.refresh(true);
  // A refused host key stays and is named here; a refused account token is forgotten, and the account says so.
  return created.status === 401 && !selfHosted ? null : refused(created.message);
}
