import type { App } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { randomHex } from '../../utils/randomHex';
import { ArmedCards } from './armedCards.ts';
import type { AssetTickets } from './assetUpload/AssetTickets.ts';
import { scaleInWindow } from './assetVariants.ts';
import type { BookShelf } from './book/BookShelf.ts';
import { tableBook, type TableBook } from './book/tableBook.ts';
import type { TableSeats } from './campaignSeats.ts';
import { companionTimers } from './companionTimers.ts';
import { CoveredPages } from './coveredPages.ts';
import type { ForkClients } from './forkClients.ts';
import { ImageShare } from './image/ImageShare.ts';
import { PAUSED_TEXT, TableGate, type GateSettings } from './joinGate.ts';
import { TableLog } from './log/TableLog.ts';
import { tableNotes } from './notes/tableNotes.ts';
import type { NotesShare } from './notes/NotesShare.ts';
import type { Ownership } from './ownership.ts';
import { FoundShare } from './pins/FoundShare.ts';
import type { SceneBinding } from './sceneBinding.ts';
import type { TableConnection } from './TableConnection.ts';
import type { OnlineTableEvents } from './tableEvents.ts';
import { readVaultImage } from './vaultImage.ts';

/** What the table's shares are built from. The connection and the bound scene come as getters: they are made after the shares. */
export interface TableSharesDeps {
  readonly app: App;
  readonly ownership: Ownership;
  readonly seats: TableSeats;
  readonly gate: GateSettings;
  readonly shelf: BookShelf;
  readonly savedLog?: unknown;
  readonly events: OnlineTableEvents;
  readonly tickets: AssetTickets;
  readonly forkClients: ForkClients;
  readonly connection: () => TableConnection;
  readonly bound: () => SceneBinding | null;
}

/** The shares a table keeps beside its scene. */
export interface TableShares {
  readonly cards: ArmedCards;
  readonly gate: TableGate;
  readonly log: TableLog;
  readonly image: ImageShare;
  readonly found: FoundShare;
  readonly notes: NotesShare;
  readonly books: TableBook;
  readonly covers: CoveredPages;
}

/** Builds the table's shares in the order they depend on each other: the cards, the gate, the log, then what writes to the log. */
export function buildShares(deps: TableSharesDeps): TableShares {
  const { app, ownership, seats, events, tickets, forkClients, connection, bound } = deps;
  const cards = new ArmedCards(companionTimers());
  const gate = new TableGate(deps.gate, {
    send: (frame) => connection().sendGate(frame),
    answer: (id, admit) => connection().answer(id, admit),
    save: (settings) => events.gate(settings),
    changed: () => events.changed(),
    paused: () => showNotice(PAUSED_TEXT),
    timers: companionTimers(),
    taken: () => seats.codes(),
    cards,
  });
  const timers = companionTimers();
  const log = new TableLog({
    send: (body, to) => connection().send(body, to),
    clock: () => Date.now(),
    now: () => timers.now(),
    randomId: () => randomHex(12),
    nameOf: (player) => ownership.nameOf(player),
    setTimer: (run, ms) => timers.setTimer(run, ms),
    clearTimer: (timer) => timers.clearTimer(timer),
    changed: () => events.log(),
    speaker: (who, key) => bound()?.share.dice.speaker(who, key) ?? Promise.resolve(null),
    rollInline: (formula) => bound()?.share.dice.quietRoll(formula) ?? null,
  }, deps.savedLog);
  const image = new ImageShare({
    send: (body, to, tag) => connection().send(body, to, tag),
    now: () => timers.now(),
    randomId: () => randomHex(12),
    scaleImage: scaleInWindow,
    changed: () => events.changed(),
    logShown: (shown, path) => log.imageShown(shown, path),
    loggedFile: (hash) => log.artFile(hash),
    readImage: (path) => readVaultImage(app, path),
    tickets,
    forkLevelOf: (player) => forkClients.levelOf(player),
  });
  const found = new FoundShare(log, {
    app, send: (body, to, tag) => connection().send(body, to, tag), now: () => timers.now(), nameOf: (player) => ownership.nameOf(player),
    readImage: (path) => readVaultImage(app, path), scaleImage: scaleInWindow, layers: () => bound()?.share.layers ?? null,
    tickets, forkLevelOf: (player) => forkClients.levelOf(player),
  });
  const notes = tableNotes({
    app, players: () => ownership.onlinePlayers(), forkLevelOf: (player) => forkClients.levelOf(player),
    send: (body, to, tag) => connection().send(body, to, tag), dropTagged: (tag) => connection().dropTagged(tag),
    randomId: () => randomHex(12), now: () => timers.now(), tickets, readImage: (path) => readVaultImage(app, path), scaleImage: scaleInWindow, timers, changed: () => events.changed(),
  });
  const books = tableBook({
    app, shelf: deps.shelf, ownership, randomId: () => randomHex(12),
    send: (body, to, tag) => connection().send(body, to, tag),
    scene: () => bound()?.book() ?? null,
    readImage: (path) => readVaultImage(app, path),
    tokenWrites: () => bound()?.resources ?? null,
    cards,
    cardsChanged: () => events.changed(),
  });
  const covers = new CoveredPages({
    // Each method by itself: the timers are a class, whose methods a spread leaves behind
    now: () => timers.now(),
    setTimer: (run, ms) => timers.setTimer(run, ms),
    clearTimer: (timer) => timers.clearTimer(timer),
    sendLive: (body, key, to) => connection().sendLive(body, key, to),
    batches: () => connection().batches,
    connected: () => connection().connected,
    uncovered: (player) => bound()?.share.catchUpMarks(player),
  });
  return { cards, gate, log, image, found, notes, books, covers };
}
