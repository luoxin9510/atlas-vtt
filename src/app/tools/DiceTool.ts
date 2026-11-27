import type { DiceRollResult } from '../types/diceTypes';
import type { DiceRollOrigin } from '../types/diceRollOrigin';
import { EventEmitter } from 'events';
import type { DiceRules } from '../types/diceRulesTypes';
import type { AdvantageSide, DiceSet, RolledWithSet, RollingDice } from '../types/diceSetTypes';
import { rollParseOptionsOf, rollingRules } from '../gameSystems/diceSets';
import type { CheckDirection, TargetStep } from '../dice/checkTypes';
import { buildRoll, refusalOf, specOfText, type RollSpec } from './buildRoll';
import type { FormulaError } from './parseFormula';
import { parseContest } from '../dice/parseContest';
import { contestSideSpec, markContest, type ContestNames } from './contestRoll';

/** How a roll is made besides its formula. */
export interface RollOptions {
  /** Rolls a bare bonus with this set instead of the collection's (a statblock's template's). */
  set?: DiceSet | undefined;
  /** Rolls with advantage or disadvantage, as the set's rule for that side says. */
  advantage?: AdvantageSide | undefined;
  /** Gives an explicit matching pool the set’s names and colours; never changes its dice. */
  setAppearance?: boolean | undefined;
  /** Who sees the roll: `'gm'` keeps it from the player window and online players (they see a secret entry); unset is everyone. */
  visibility?: 'all' | 'gm' | undefined;
  /** What moved the target of the check in the text (modifiers on a check that goes under); the result records them. Ignored for a roll that is no check. */
  targetSteps?: readonly TargetStep[] | undefined;
}

/** How a contest is rolled: the options of any roll, and who the two sides are. */
export interface ContestOptions extends RollOptions {
  names?: ContestNames | undefined;
  /** What moved each side's target, as `targetSteps` does for one roll (which a contest ignores). */
  sideSteps?: { first?: readonly TargetStep[] | undefined; second?: readonly TargetStep[] | undefined } | undefined;
}

/** How a check is rolled: the options of any roll, and a direction that overrides the system's. */
export interface CheckOptions extends RollOptions {
  direction?: CheckDirection | undefined;
}

export interface DiceToolState {
  isTrayOpen: boolean;
  rollHistory: DiceRollResult[];
  activeFormula: string;
  quickDice: string[]; // Quick access dice buttons
}

export interface DiceRollInputs {
  random: () => number;
  rollId: () => string;
  roller: () => string;
  onFormulaError: (error: FormulaError) => void;
}

export class DiceTool {
  public state: DiceToolState;
  private eventBus: EventEmitter;
  /** The dice this tool rolls a bare bonus with: its map's dice set. */
  readonly getDiceRules: () => DiceRules | RollingDice;

  /** `getDiceRules` gives the dice a bare bonus rolls with: the collection's dice set. */
  constructor(eventBus: EventEmitter, getDiceRules: () => DiceRules | RollingDice, private readonly inputs: DiceRollInputs) {
    this.eventBus = eventBus;
    this.getDiceRules = getDiceRules;
    this.state = {
      isTrayOpen: false,
      rollHistory: [],
      activeFormula: '',
      quickDice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']
    };
  }

  public toggleTray(): void {
    this.state.isTrayOpen = !this.state.isTrayOpen;
    this.eventBus.emit('dice-tray-toggled', this.state.isTrayOpen);
  }

  /**
   * Rolls `formula` for `source`. `origin` says which token of which scene the roll was
   * made for; it goes out with the `dice-rolled` event and is kept nowhere. `options` may
   * name a dice set instead of the collection's and a side of advantage.
   */
  public rollDice(formula: string, source?: DiceRollResult['source'], origin?: DiceRollOrigin, options?: RollOptions): DiceRollResult | null {
    const contest = parseContest(formula, rollParseOptionsOf(rollingWith(this.getDiceRules(), options?.set).rules));
    if (contest) return this.rollContestSides(contest.first, contest.second, source, origin, options)?.[1] ?? null;
    return this.record(this.parseAndRoll(formula, options, options?.targetSteps), source, origin, options);
  }

  /**
   * Rolls `formula` against `target` as a check, as `rollDice` rolls `formula vs target`; without a
   * direction in `options` the system's own decides. The result's formula is the check text.
   */
  public rollCheck(formula: string, target: number, options?: CheckOptions): DiceRollResult | null {
    const written = options?.direction;
    return this.record(this.parseAndRoll({ formula, check: { target, ...(written && { written }) } }, options), undefined, undefined, options);
  }

  /**
   * Rolls two checks against each other: `first`, then `second`, each a check (`3d6 vs 12`) or a bare
   * target (`12`, the set's default roll against it), as `rollCheck` rolls one. Both are logged and
   * announced as two normal rolls and carry a `contest` that names the pair and the verdict (on the
   * second). Null, with nothing rolled, where a side is no check or refuses its formula. `rollDice`
   * rolls contest text (`12 对 14`) the same way and returns the second result.
   */
  public rollContest(first: string, second: string, options?: ContestOptions): [DiceRollResult, DiceRollResult] | null {
    return this.rollContestSides(first, second, undefined, undefined, options);
  }

  private rollContestSides(
    first: string, second: string, source: DiceRollResult['source'] | undefined, origin: DiceRollOrigin | undefined, options: ContestOptions | undefined,
  ): [DiceRollResult, DiceRollResult] | null {
    const { rules } = rollingWith(this.getDiceRules(), options?.set);
    const pair = rollContestPair(first, second, rules, () => this.inputs.rollId(), options?.names, {
      precheck: (firstSpec, secondSpec) => {
        const refused = refusalOf(firstSpec, rules, options?.advantage) ?? refusalOf(secondSpec, rules, options?.advantage);
        if (refused) this.inputs.onFormulaError(refused);
        return refused === null;
      },
      rollSide: (spec, side) => this.parseAndRoll(spec, options, options?.sideSteps?.[side]),
    });
    if (!pair) return null;
    this.record(pair[0], source, origin, options);
    this.record(pair[1], source, origin, options);
    return pair;
  }

  /** Puts a rolled result in the history and announces it; a GM-only roll is marked `hidden` first. */
  private record(result: DiceRollResult | null, source?: DiceRollResult['source'], origin?: DiceRollOrigin, options?: RollOptions): DiceRollResult | null {
    if (!result) return null;
    if (source) {
      result.source = source;
    }
    if (options?.visibility === 'gm') result.hidden = true;
    
    // Add to history
    this.state.rollHistory.unshift(result);
    
    // Keep only last 50 rolls
    if (this.state.rollHistory.length > 50) {
      this.state.rollHistory = this.state.rollHistory.slice(0, 50);
    }
    
    this.eventBus.emit('dice-rolled', result, origin);

    return result;
  }

  /** Rolls the formula; one without dice (`+3`) is added to the dice of the set. */
  private parseAndRoll(spec: RollSpec | string, options: RollOptions | undefined, steps?: readonly TargetStep[]): DiceRollResult | null {
    const { rules, shown } = rollingWith(this.getDiceRules(), options?.set);
    return rollSpec(withSteps(typeof spec === 'string' ? specOfText(spec, rollParseOptionsOf(rules)) : spec, steps), rules, this.inputs, shown, options?.advantage, options?.setAppearance ?? false);
  }

  /** The dice a roll of `set` (else the collection's) is made with, and their rules: what advantage can do. */
  public rollingDice(set?: DiceSet): RollingDice {
    return rollingRules(rollingWith(this.getDiceRules(), set).rules);
  }

  public clearHistory(): void {
    this.state.rollHistory = [];
    this.eventBus.emit('dice-history-cleared');
  }

  public setActiveFormula(formula: string): void {
    this.state.activeFormula = formula;
  }

  public getQuickDice(): string[] {
    return this.state.quickDice;
  }

  public addQuickDie(die: string): void {
    if (!this.state.quickDice.includes(die)) {
      this.state.quickDice.push(die);
    }
  }

  public removeQuickDie(die: string): void {
    this.state.quickDice = this.state.quickDice.filter(d => d !== die);
  }

  // Get current state
  public getState(): DiceToolState {
    return { ...this.state };
  }
}

/**
 * The dice a bare bonus rolls with: `set` where one is given (a statblock's
 * template's), else the collection's. A roll names the set (`shown`) only
 * where it is not the collection's own.
 */
export function rollingWith(
  collection: DiceRules | RollingDice, set: DiceSet | undefined,
): { rules: DiceRules | RollingDice; shown?: RolledWithSet } {
  if (!set) return { rules: collection };
  const own = 'id' in collection && collection.id === set.id;
  return own ? { rules: collection } : { rules: set, shown: { id: set.id, name: set.name } };
}

/**
 * Rolls a formula by a dice set (or a collection's dice rules), as the dice
 * tool does but without telling anyone: one without dice (`+3`) is added to
 * the set's dice, which take their names and colours, and an empty one rolls
 * them alone. Dice written out roll as written. `advantage` rolls a roll of the
 * set's dice as its rule for that side says. A formula it refuses (advantage
 * taking it past a limit too) is reported to `inputs.onFormulaError` and rolls
 * nothing (null). `shown` names the set on the result, where it is not the
 * collection's own.
 */
export function rollDiceFormula(
  formula: string, rules: DiceRules | RollingDice, inputs: DiceRollInputs, shown?: RolledWithSet, advantage?: AdvantageSide, setAppearance = false,
  steps?: readonly TargetStep[],
): DiceRollResult | null {
  return rollSpec(withSteps(specOfText(formula, rollParseOptionsOf(rules)), steps), rules, inputs, shown, advantage, setAppearance);
}

/**
 * Rolls a contest by a dice set without telling anyone, as `rollDiceFormula` rolls a formula: both
 * sides rolled, marked as the two of one contest with the verdict on the second. Null, rolling
 * nothing, where a side is no check, and where a side's formula is refused (reported to `inputs`).
 */
export function rollContestFormulas(
  first: string, second: string, rules: DiceRules | RollingDice, inputs: DiceRollInputs, shown?: RolledWithSet, names?: ContestNames,
): [DiceRollResult, DiceRollResult] | null {
  return rollContestPair(first, second, rules, () => inputs.rollId(), names, {
    rollSide: (spec) => rollSpec(spec, rules, inputs, shown, undefined, false),
  });
}

/** What differs between rolling a contest with a dice tool and without one. */
interface ContestRoller {
  /** Looks at both sides before anything is rolled; false stops the contest (and has said why). */
  precheck?: (first: RollSpec, second: RollSpec) => boolean;
  /** Rolls one side as a spec; null where it refuses. */
  rollSide: (spec: RollSpec, side: 'first' | 'second') => DiceRollResult | null;
}

/**
 * The core of rolling a contest: both sides read as checks, rolled in turn, marked as the two of one
 * contest with the verdict on the second. Null, rolling nothing further, where a side is no check, the
 * precheck stops it, or a side refuses.
 */
function rollContestPair(
  first: string, second: string, rules: DiceRules | RollingDice, rollId: () => string, names: ContestNames | undefined, { precheck, rollSide }: ContestRoller,
): [DiceRollResult, DiceRollResult] | null {
  const firstSpec = contestSideSpec(first);
  const secondSpec = contestSideSpec(second);
  if (!firstSpec || !secondSpec) return null;
  if (precheck && !precheck(firstSpec, secondSpec)) return null;
  const firstRoll = rollSide(firstSpec, 'first');
  const secondRoll = firstRoll && rollSide(secondSpec, 'second');
  if (!firstRoll || !secondRoll) return null;
  markContest(firstRoll, secondRoll, rollId(), rules, names);
  return [firstRoll, secondRoll];
}

/** `spec` with the steps that moved its target, where it is a check and there are any. */
function withSteps(spec: RollSpec, steps: readonly TargetStep[] | undefined): RollSpec {
  return spec.check && steps && steps.length > 0 ? { ...spec, check: { ...spec.check, steps } } : spec;
}

/** Rolls a spec (a formula, or a check) and dresses the body with its id, time, roller and set. */
function rollSpec(
  spec: RollSpec, rules: DiceRules | RollingDice, inputs: DiceRollInputs, shown: RolledWithSet | undefined, advantage: AdvantageSide | undefined, setAppearance: boolean,
): DiceRollResult | null {
  const body = buildRoll(spec, rules, inputs.random, advantage, setAppearance);
  if ('ok' in body) {
    inputs.onFormulaError(body);
    return null;
  }
  return { id: inputs.rollId(), timestamp: Date.now(), ...body, player: inputs.roller(), ...(shown && { diceSet: shown }) };
}
