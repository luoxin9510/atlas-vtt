import type { App } from 'obsidian';
import { AssetService } from '../../services/AssetService';
import { CampaignBooks } from '../../campaigns/players/CampaignBooks';
import { CampaignPlayers } from '../../campaigns/players/CampaignPlayers';
import { NO_ASSIGNMENTS, type TokenAssignments } from '../../campaigns/players/tokenAssignments';
import type { BookShelf } from './book/BookShelf.ts';
import { campaignBookSource, type BoundBookSource } from './book/campaignBookSource.ts';
import type { BookData } from './book/bookStore.ts';
import { carryBooksOver } from './book/legacyBooks.ts';
import { carryAssignmentsOver } from './legacyAssignments.ts';
import { appCampaigns, type TableCampaigns } from './tableCampaigns.ts';

/** What `LegacyData` needs of the feature that owns it. */
export interface LegacyPorts {
  app: App;
  /** Where the shelf keeps books: the campaign's books file once a table is bound to one. */
  bookSource: BoundBookSource;
  /** The players' books. */
  books: BookShelf;
  /** Writes the data file, which no longer carries what was carried over. */
  save(): Promise<void>;
}

/**
 * What an older Atlas kept in this device's data (books, token owners, player tokens) until a
 * campaign's files have taken it over.
 */
export class LegacyData {
  /** The books an older Atlas kept in this device's data, until a campaign's file has taken them over. */
  books: BookData = {};
  /** The token owners and player tokens an older Atlas kept in this device's data, until a campaign's players file has taken them over. */
  assignments: TokenAssignments = NO_ASSIGNMENTS;

  constructor(private readonly ports: LegacyPorts) {}

  /**
   * From now on the players' books are kept in the books file of this campaign, or in memory only for
   * null; what the shelf held in memory of library tokens' books is forgotten, so it never hides the file's.
   */
  bindBooks(campaignId: string | null): void {
    const books = CampaignBooks.forApp(this.ports.app);
    this.ports.bookSource.bind(campaignId === null || books === undefined ? null : campaignBookSource(books, campaignId));
    if (campaignId !== null) this.ports.books.forgetKept();
  }

  /**
   * Carries the books an older Atlas kept in this device's data into the campaign's books file,
   * once: the data file loses the books it carried over only after the campaign's file was read back with them, and keeps those no library token takes over.
   */
  async migrateBooksInto(campaignId: string): Promise<void> {
    const books = CampaignBooks.forApp(this.ports.app);
    if (books === undefined || Object.keys(this.books).length === 0) return;
    await books.whenLoaded();
    const assets = await AssetService.getInstance(this.ports.app).getTokenAssets();
    const tokens = assets.map(({ id, collection, imagePath }) => ({ id, collection, imagePath }));
    const left = await carryBooksOver(this.books, tokens, books, campaignId);
    // Nothing was carried over: the data file stays as it is.
    if (left === null || JSON.stringify(left) === JSON.stringify(this.books)) return;
    this.books = left;
    await this.ports.save();
  }

  /**
   * Carries the token owners and player tokens an older Atlas kept in this device's data into the
   * campaign's players file, once: the data file loses them only after the campaign's file was read back with them.
   */
  async migrateAssignmentsInto(campaignId: string): Promise<void> {
    const players = CampaignPlayers.forApp(this.ports.app);
    if (players === undefined || this.assignments === NO_ASSIGNMENTS) return;
    await players.whenLoaded();
    if (!(await carryAssignmentsOver(this.assignments, players, campaignId))) return;
    this.assignments = NO_ASSIGNMENTS;
    await this.ports.save();
  }

  /**
   * The campaigns tables run on: what an older Atlas kept in this device's data (books, token owners,
   * player tokens) is carried into a campaign before a table of it runs (a player's book written
   * meanwhile would otherwise replace the carried one), and a table binds its campaign's books.
   */
  campaigns(): TableCampaigns {
    return appCampaigns(this.ports.app, (campaignId) => this.bindBooks(campaignId), async (campaignId) => {
      await this.migrateBooksInto(campaignId);
      await this.migrateAssignmentsInto(campaignId);
    });
  }
}
