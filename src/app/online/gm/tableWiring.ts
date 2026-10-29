import type { GmMessage } from '../protocol/index.ts';
import type { App } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { randomHex } from '../../utils/randomHex';
import type { AssetTickets } from './assetUpload/AssetTickets.ts';
import { gatedRests } from './book/restGate.ts';
import type { TableLog } from './log/TableLog.ts';
import { restChangeOwners, restRecordOf } from './log/restEntry.ts';
import { ATLAS_VIEW_TYPE } from './atlasView.ts';
import type { ForkClients } from './forkClients.ts';
import type { Ownership } from './ownership.ts';
import { presentedScene } from './presentedScene.ts';
import { bindScene, type SceneBinding } from './sceneBinding.ts';
import { TabWatch } from './sharedTab.ts';
import type { TableStatus, TableEvents } from './TableConnection.ts';
import type { TableRoster } from './tableRoster.ts';
import type { TableShares } from './tableShares.ts';
import { LOST_NOTICES, type OnlineTableEvents } from './tableEvents.ts';
import { readVaultImage } from './vaultImage.ts';
import type { PauseShare } from './PauseShare.ts';

/** What the watch on the presented tab reads from the table. Whatever is made after the watch comes as a getter. */
export interface SceneWatchPorts {
  readonly app: App;
  readonly ownership: Ownership;
  readonly forkClients: ForkClients;
  readonly tickets: AssetTickets;
  readonly pauseShare: PauseShare;
  readonly shares: Pick<TableShares, 'covers' | 'log' | 'found'>;
  readonly events: OnlineTableEvents;
  readonly mapPath: string | null;
  readonly send: (body: GmMessage, to?: string, tag?: string) => void;
  readonly withdraw: () => void;
}

/** Follows the presented Atlas tab and binds the scene share to it. */
export function sceneWatch(ports: SceneWatchPorts): TabWatch<SceneBinding> {
  const { app, ownership, forkClients, tickets, pauseShare, shares, events } = ports;
  const watch: TabWatch<SceneBinding> = new TabWatch<SceneBinding>({
    leaves: () => app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE),
    presented: () => presentedScene(app),
    bind: (tab, presented) => bindScene({
      app,
      seats: ownership,
      forkLevelOf: (player) => forkClients.levelOf(player),
      tickets,
      paused: () => pauseShare.paused,
      send: (body, to, tag) => ports.send(body, to, tag),
      sendLive: (body, key, to) => shares.covers.sendLive(body, key, to),
      readImage: (path) => readVaultImage(app, path),
      isLive: (binding) => watch.isLive(binding),
      randomId: () => randomHex(12),
      logRoll: (roll) => shares.log.rolled(roll),
      logArt: (hash) => shares.log.artFile(hash),
      rollRequest: (from, answer) => shares.log.requestOf(from, answer),
      foundPin: (map, pin) => shares.found.entryOf(map, pin),
      nameOf: (player) => ownership.nameOf(player),
    }, tab, presented),
    lost: (reason) => {
      ports.withdraw();
      const notice = LOST_NOTICES[reason];
      if (notice !== null) showNotice(notice);
    },
    mapPath: (path) => events.mapPath(path),
  }, ports.mapPath);
  return watch;
}

/** What the connection's callbacks reach. The roster is made after the connection, so it comes as a getter. */
export interface ConnectionPorts {
  readonly ownership: Ownership;
  readonly forkClients: ForkClients;
  readonly shares: TableShares;
  readonly roster: () => TableRoster;
  readonly bound: () => SceneBinding | null;
  readonly resend: (to?: string) => void;
  readonly setStatus: (status: TableStatus) => void;
  readonly setClosing: (closesAt: number | null) => void;
  readonly sceneOrGone: (from: string, body: unknown) => boolean;
}

/** The callbacks of the table's socket: who came and went, what they send, and how the connection stands. */
export function connectionHandlers(ports: ConnectionPorts): TableEvents {
  const { ownership, forkClients, shares } = ports;
  const { log, covers, image, books, found, notes } = shares;
  return {
    status: (status) => ports.setStatus(status),
    // The scene and tokens first: the players' mine messages follow from the ownership change.
    welcome: (connected) => {
      // Who joined while the GM was away is seated as one who joins now; who came or went is in the log before it goes out again.
      const players = connected.filter((player) => ports.roster().joined(player));
      log.welcome(players);
      // Pages say again with the books that follow whether theirs covers the map.
      covers.reset();
      ports.resend();
      ownership.welcome(players);
    },
    joined: (player) => {
      if (!ports.roster().joined(player)) return;
      // The log as it was, then the line that they joined, which everyone gets.
      ports.resend(player.id);
      ownership.joined(player);
      log.joined(player);
    },
    left: (player) => {
      forkClients.forget(player);
      covers.playerLeft(player);
      ports.bound()?.share.playerLeft(player);
      image.playerLeft(player);
      books.share.playerLeft(player);
      found.playerLeft(player);
      notes.playerLeft(player);
      ownership.left(player);
      log.left(player);
    },
    // The log, the shown image and the books are the table's, so they hear players while no scene is shared too.
    message: (from, body) => void (forkClients.receive(from, body) || covers.receive(from, body) || log.receive(from, body) || image.receive(from, body) || notes.receive(from, body) || found.receive(from, body) || books.share.receive(from, body) || ports.sceneOrGone(from, body)),
    access: (closesAt) => ports.setClosing(closesAt),
  };
}

/** Every rest that reaches a character of this table the GM's Atlas takes while it runs is logged: approved requests and the GM's own. Returns what stops it. */
export function logRests(log: TableLog, ownership: Ownership, books: { playersOf(characterId: string): readonly string[] }): () => void {
  // The players of a character (a library token's id): the campaign's player it was given to, and whoever plays it at the table now.
  const playersOfCharacter = (characterId: string): string[] => {
    const owner = ownership.ownerOfCharacter(characterId);
    return [...new Set([...(owner === undefined ? [] : [owner]), ...books.playersOf(characterId)])];
  };
  return gatedRests.onRested((rest) => {
    const players = playersOfCharacter(rest.characterId);
    const changePlayers = restChangeOwners(rest).map((id) => (id === rest.characterId ? [] : playersOfCharacter(id)));
    if (players.length > 0 || changePlayers.some((list) => list.length > 0)) log.rested(restRecordOf(rest), players, changePlayers);
  });
}
