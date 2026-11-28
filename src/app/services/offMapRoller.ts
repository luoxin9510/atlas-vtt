import type { App } from 'obsidian';
import { collectionIdOfPath } from './assetPaths';
import { collectionRolling } from './collectionRolling';
import { forgetOffMapRollFeed, provideOffMapRollFeed } from './offMapRollFeed';
import type { OffMapRolls } from './statblockRolls';
import type { ContestOptions, RollOptions } from '../tools/DiceTool';
import type { DiceRollOrigin } from '../types/diceRollOrigin';
import type { DiceRollResult } from '../types/diceTypes';

type RollSource = NonNullable<DiceRollResult['source']>;

/** One roll made with no map open, and the window it was made in: what the dice layers show. */
export interface OffMapRolled {
  result: DiceRollResult;
  /** The document (window) the roll was made in; its layer shows it. */
  doc: Document;
  /** Whether another display already plays its sounds. */
  muted: boolean;
  origin?: DiceRollOrigin | undefined;
}

/** How a roll made with no map open is made: the options of any roll, and where it was made. */
export interface OffMapRollOptions extends RollOptions {
  /** What the log names as the roll's source. */
  source?: RollSource | undefined;
  origin?: DiceRollOrigin | undefined;
  /** The note it was rolled for: the collection whose folder holds it picks the dice set (else the library's default). */
  notePath?: string | null | undefined;
  /** The collection whose dice set rolls, where the caller knows it without a note (a rule pack's); it wins over `notePath`. */
  collectionId?: string | null | undefined;
  /** The window it was made in; the focused one (`activeDocument`) when unset. */
  doc?: Document | undefined;
}

export type OffMapContestOptions = Omit<ContestOptions, 'sides'> & Pick<OffMapRollOptions, 'notePath' | 'collectionId' | 'doc'> & {
  sources?: [RollSource, RollSource] | undefined;
};

type RollListener = (rolled: OffMapRolled) => void;

const HISTORY_LENGTH = 20;
const STATBLOCK_SOURCE: RollSource = { type: 'statblock' };

/**
 * The one roller of every roll made while no map is open: the pure builders maps use
 * (`collectionRolling`), by the dice set of the collection the note is in, else the library's
 * default; GM-only as the GM's switch says. Each result is announced with its window (`onRoll`),
 * where the window's dice layer shows it, and the last 20 are kept in memory.
 */
export class OffMapRoller {
  private static readonly byApp = new WeakMap<object, OffMapRoller>();

  /** The one roller of `app`, made when first asked for. */
  static forApp(app: App): OffMapRoller {
    let roller = OffMapRoller.byApp.get(app);
    if (!roller) {
      roller = new OffMapRoller(app);
      provideOffMapRollFeed(app, roller);
      OffMapRoller.byApp.set(app, roller);
    }
    return roller;
  }

  /** The roller of `app` if the plugin made one (not in a test that made none). */
  static existing(app: App): OffMapRoller | undefined {
    return OffMapRoller.byApp.get(app);
  }

  static release(app: App): void {
    OffMapRoller.byApp.get(app)?.dispose();
    OffMapRoller.byApp.delete(app);
    forgetOffMapRollFeed(app);
  }

  private readonly listeners = new Set<RollListener>();
  private readonly kept: OffMapRolled[] = [];

  private constructor(private readonly app: App) {}

  /** Rolls and announces; null (nothing announced) for a formula it refuses. */
  roll(formula: string, options: OffMapRollOptions = {}): DiceRollResult | null {
    const result = this.rolling(options.notePath, options.collectionId).roll(formula, options.source ?? STATBLOCK_SOURCE, options);
    if (result) this.emit({ result, doc: options.doc ?? activeDocument, muted: false, origin: options.origin });
    return result;
  }

  /** Rolls two checks against each other and announces both sides; null (nothing rolled) where either is refused. */
  rollContest(first: string, second: string, options: OffMapContestOptions = {}): [DiceRollResult, DiceRollResult] | null {
    const sources = options.sources ?? [STATBLOCK_SOURCE, STATBLOCK_SOURCE];
    const pair = this.rolling(options.notePath, options.collectionId).rollContest(first, second, sources, options);
    const doc = options.doc ?? activeDocument;
    pair?.forEach((result) => this.emit({ result, doc, muted: false }));
    return pair;
  }

  /**
   * The surface the statblock links of a note use while no map is open: it rolls here and shows
   * through `show`, which announces the result in the window that is focused when it is made.
   */
  offMapRolls(notePath: string | null | undefined): OffMapRolls {
    return {
      ...this.rolling(notePath),
      show: (result, muted) => this.emit({ result, doc: activeDocument, muted }),
    };
  }

  /** Hears every roll with the window it was made in; returns what stops it. */
  onRoll(listener: RollListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The last 20 rolls, the newest last. */
  history(): readonly OffMapRolled[] {
    return [...this.kept];
  }

  dispose(): void {
    this.listeners.clear();
    this.kept.length = 0;
  }

  private rolling(notePath: string | null | undefined, collectionId?: string | null): ReturnType<typeof collectionRolling> {
    return collectionRolling(this.app, () => collectionId ?? collectionIdOfPath(notePath));
  }

  private emit(rolled: OffMapRolled): void {
    this.kept.push(rolled);
    if (this.kept.length > HISTORY_LENGTH) this.kept.splice(0, this.kept.length - HISTORY_LENGTH);
    for (const listener of [...this.listeners]) listener(rolled);
  }
}
