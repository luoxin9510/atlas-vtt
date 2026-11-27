import type { DiceRollResult } from '../types/diceTypes';
import type { DiceRollOrigin } from '../types/diceRollOrigin';
import { EventEmitter } from 'events';
import type { DiceRules } from '../types/diceRulesTypes';
import type { AdvantageSide, DiceSet, RolledWithSet, RollingDice } from '../types/diceSetTypes';
import { rollingRules } from '../gameSystems/diceSets';
import type { CheckDirection } from '../dice/checkTypes';
import { buildRoll, specOfText, type RollSpec } from './buildRoll';
import type { FormulaError } from './parseFormula';

/** How a roll is made besides its formula. */
export interface RollOptions {
  /** Rolls a bare bonus with this set instead of the collection's (a statblock's template's). */
  set?: DiceSet | undefined;
  /** Rolls with advantage or disadvantage, as the set's rule for that side says. */
  advantage?: AdvantageSide | undefined;
  /** Gives an explicit matching pool the set’s names and colours; never changes its dice. */
  setAppearance?: boolean | undefined;
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
    return this.record(this.parseAndRoll(specOfText(formula), options), source, origin);
  }

  /**
   * Rolls `formula` against `target` as a check, as `rollDice` rolls `formula vs target`; without a
   * direction in `options` the system's own decides. The result's formula is the check text.
   */
  public rollCheck(formula: string, target: number, options?: CheckOptions): DiceRollResult | null {
    const written = options?.direction;
    return this.record(this.parseAndRoll({ formula, check: { target, ...(written && { written }) } }, options));
  }

  /** Puts a rolled result in the history and announces it. */
  private record(result: DiceRollResult | null, source?: DiceRollResult['source'], origin?: DiceRollOrigin): DiceRollResult | null {
    if (!result) return null;
    if (source) {
      result.source = source;
    }
    
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
  private parseAndRoll(spec: RollSpec, options: RollOptions | undefined): DiceRollResult | null {
    const { rules, shown } = rollingWith(this.getDiceRules(), options?.set);
    return rollSpec(spec, rules, this.inputs, shown, options?.advantage, options?.setAppearance ?? false);
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
): DiceRollResult | null {
  return rollSpec(specOfText(formula), rules, inputs, shown, advantage, setAppearance);
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
