/**
 * Click-to-roll dice notation, routed through Atlas' own dice tool (toast, roll
 * log) or, without a map on screen, the surface the statblock is drawn on
 * (`statblockRolls.ts`).
 *
 * Two halves, deliberately separate:
 *
 * - `linkDiceIn` rewrites text nodes into clickable spans. It must ONLY be used
 *   on static DOM that Atlas produced and owns — the output of Obsidian's
 *   MarkdownRenderer and the DOM a layout's `javascript` block returns, both
 *   rebuilt wholesale on every render.
 *   Never point it at DOM owned by React or Svelte: those frameworks hold
 *   references to the text nodes it replaces, and throw on their next update.
 * - `attachDiceRolling` only listens for clicks, so it is safe on any container.
 *
 * A click rolls; Shift-click rolls with advantage and Alt-click (Option) with
 * disadvantage, both at once cancel. A right-click offers the three, the
 * advantage ones only where the dice set has a rule for them and the roll
 * holds its dice.
 */

import type { App } from 'obsidian';
import { rollStatblockDice, statblockRollingDice, type ContestSide, type DiceRollSource, type OffMapRolls } from './statblockRolls';
import { answerPendingContest, cancelPendingContest, startPendingContest } from './pendingContest';
import { advantageSide, advantageSidesFor } from '../tools/diceAdvantage';
import type { AdvantageSide } from '../types/diceSetTypes';
import { t } from '../i18n';
import { BONUS_ID_ATTRIBUTE } from '../statblocks/rollBonuses/armedBonuses';
import { splitDiceSegments, toRollFormula } from './statblockDiceText';
import type { RollParseOptions } from '../tools/formulaTypes';
import { rollParseOptionsOf } from '../gameSystems/diceSets';
import { specOfText } from '../tools/buildRoll';
import { parseModifier, withTargetModifier } from '../tools/targetModifier';
import { promptForText } from '../ui/textInputDialog';

const LINK_CLASS = 'atlas-dice-link';

/** Set by the statblock renderer on the line that holds a creature's hit points. */
const HIT_POINTS_SELECTOR = '[data-hit-points]';

/** Elements whose text must never be rewritten. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'BUTTON']);

/** Receives clicks on hit dice, in place of the ordinary roll. */
export type HitPointsRollHandler = (formula: string, abilityName: string | undefined) => void;

/** One choice of a roll link's menu: a roll, with advantage, or with disadvantage (`side`). */
export interface RollChoice {
  label: string;
  side: AdvantageSide | null;
  roll: () => void;
}

/**
 * Opens a roll link's menu at a point in the link's document; `link` takes
 * focus back where the menu was opened from the keyboard.
 */
export type RollMenuOpener = (choices: readonly RollChoice[], at: { x: number; y: number }, link: HTMLElement) => void;

const SIDE_LABELS: Record<AdvantageSide, () => string> = {
  advantage: () => t('dice.rollWithAdvantage'),
  disadvantage: () => t('dice.rollWithDisadvantage'),
};

/** Nearest heading-ish label above the roll, used to title the dice toast. */
function abilityNameFor(node: Node): string | undefined {
  // A table cell holds no label of its own: its column names the roll
  const column = node.parentElement?.closest<HTMLElement>('[data-roll-name]')?.dataset.rollName;
  if (column) return column;

  const el = node.parentElement?.closest<HTMLElement>(
    '.atlas-sb-trait, .atlas-sb-property, .atlas-sb-labelled, li, p, tr',
  );
  const name = el?.querySelector<HTMLElement>(
    '.atlas-sb-trait-name, .atlas-sb-property-name, .atlas-sb-label, strong, em, b, i',
  )?.textContent;
  return name?.trim().replace(/[:.]$/, '') || undefined;
}

/** The value whose own number a link is (`BONUS_ID_ATTRIBUTE`), if it is one. */
function rolledBonusOf(link: HTMLElement): string | undefined {
  return link.closest<HTMLElement>(`[${BONUS_ID_ATTRIBUTE}]`)?.getAttribute(BONUS_ID_ATTRIBUTE) ?? undefined;
}

function isSkipped(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest(`.${LINK_CLASS}`)) return true;
  return SKIPPED_TAGS.has(parent.tagName);
}

function linkTextNode(textNode: Text, options: RollParseOptions): void {
  const text = textNode.nodeValue ?? '';
  const segments = splitDiceSegments(text, options);
  if (!segments.some((segment) => segment.dice)) return;

  const fragment = createFragment();
  for (const { text: matched, dice } of segments) {
    if (!dice) {
      fragment.append(matched);
      continue;
    }
    const link = createSpan();
    link.className = LINK_CLASS;
    link.textContent = matched;
    link.dataset.formula = toRollFormula(matched);
    link.setAttribute('role', 'button');
    link.setAttribute('tabindex', '0');
    link.setAttribute('aria-label', t('dice.rollFormula', { formula: link.dataset.formula ?? '' }));
    fragment.append(link);
  }
  textNode.replaceWith(fragment);
}

/**
 * Wraps dice notation in `root` with clickable spans.
 * Only safe on static, Atlas-owned DOM — see the note at the top of this file.
 * `options.defaultFaces`: the faces of a die written without them (`1d+2`), where the statblock's set opts in.
 */
export function linkDiceIn(root: HTMLElement, options: RollParseOptions = {}): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isSkipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });

  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    targets.push(current as Text);
    current = walker.nextNode();
  }

  targets.forEach((textNode) => linkTextNode(textNode, options));
}

/**
 * Wires click-to-roll into a container. Listens only — the dice spans
 * themselves are produced by the renderer (or by `linkDiceIn` on static DOM),
 * so this never mutates the container. Returns a disposer.
 *
 * Dice on the hit-points line go to `onRollHitPoints` when one is given, and
 * roll without advantage. `offMap` is read at each roll: where it shows rolls
 * no map on screen shows. `openMenu` shows a roll link's right-click menu.
 */
export function attachDiceRolling(
  el: HTMLElement,
  app: App,
  getSource: () => DiceRollSource,
  onRollHitPoints?: HitPointsRollHandler,
  offMap?: () => OffMapRolls | null,
  openMenu?: RollMenuOpener,
): () => void {
  let cleaned = false;
  const isCheck = (formula: string): boolean => {
    const rules = statblockRollingDice(app, getSource(), offMap?.());
    return specOfText(formula, rules ? rollParseOptionsOf(rules) : {}).check !== undefined;
  };
  // A check is never a hit-points roll: its total is judged against a target, not taken as hit points.
  const hitDice = (link: HTMLElement, formula: string): boolean =>
    onRollHitPoints !== undefined && /d\d/i.test(formula) && link.closest(HIT_POINTS_SELECTOR) !== null && !isCheck(formula);

  const roll = (link: HTMLElement, side: AdvantageSide | null, modifier?: number): void => {
    const linked = link.dataset.formula;
    if (!linked) return;
    // A one-off modifier goes where armed bonuses do (`withTargetModifier`); they are added after it.
    const rules = modifier === undefined ? null : statblockRollingDice(app, getSource(), offMap?.());
    const formula = modifier === undefined ? linked : withTargetModifier(linked, modifier, rules ?? undefined);

    const abilityName = abilityNameFor(link);
    if (hitDice(link, formula)) {
      onRollHitPoints?.(formula, abilityName);
      return;
    }

    // A value that adds to rolls, rolled from its own number, is in the roll once: as the number clicked.
    const rolledBonus = rolledBonusOf(link);
    // The names a formula was filled in with are looked up by the formula as linked, so a modifier keeps them
    const source = getSource();
    const named = modifier === undefined ? undefined : source.namedRolls?.get(linked);
    const namedRolls = named === undefined || !source.namedRolls ? source.namedRolls
      : new Map(source.namedRolls).set(formula, withTargetModifier(named, modifier ?? 0, rules ?? undefined));
    rollStatblockDice(app, formula, { ...source, namedRolls, abilityName, rolledBonus }, offMap?.(), side);
  };

  /** A link as one side of a contest: its check, and where it was clicked. */
  const sideOf = (link: HTMLElement): ContestSide => ({
    formula: link.dataset.formula ?? '',
    source: { ...getSource(), abilityName: abilityNameFor(link), rolledBonus: rolledBonusOf(link) },
    offMap: offMap?.(),
  });

  /** A link activated: it answers a contest that waits, else rolls as given. */
  const activate = (link: HTMLElement, side: AdvantageSide | null): void => {
    if (answerPendingContest(link, isCheck(link.dataset.formula ?? ''), () => sideOf(link))) return;
    roll(link, side);
  };

  const linkOf = (event: Event): HTMLElement | null =>
    (event.target as HTMLElement | null)?.closest<HTMLElement>(`.${LINK_CLASS}`) ?? null;

  const onClick = (event: MouseEvent): void => {
    const link = linkOf(event);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    activate(link, advantageSide(event.shiftKey, event.altKey));
  };

  // Enter and Space roll a focused die; the editing around it never sees the key.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = linkOf(event);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    activate(link, advantageSide(event.shiftKey, event.altKey));
  };

  // Nothing is kept: each ask starts empty, and Escape or an invalid entry rolls nothing.
  const askModifier = (link: HTMLElement): void => {
    void promptForText({
      title: t('dice.rollWithModifier'),
      confirmLabel: t('dice.roll'),
      placeholder: '-2',
      singleLine: true,
      validate: (text) => {
        const modifier = parseModifier(text);
        if (modifier === null) return t('dice.modifierInvalid');
        // A modifier that would take the target past what a check holds leaves the text as it was: refused
        const linked = link.dataset.formula ?? '';
        const rules = statblockRollingDice(app, getSource(), offMap?.()) ?? undefined;
        return modifier !== 0 && withTargetModifier(linked, modifier, rules) === linked ? t('dice.modifierInvalid') : null;
      },
    }).then((text) => {
      // The dialog may outlive the statblock it was asked from
      if (cleaned) return;
      const modifier = text === null ? null : parseModifier(text);
      if (modifier !== null) roll(link, null, modifier);
    });
  };

  const onContextMenu = (event: MouseEvent): void => {
    const link = linkOf(event);
    const formula = link?.dataset.formula;
    if (!openMenu || !link || !formula || hitDice(link, formula)) return;
    event.preventDefault();
    event.stopPropagation();
    const rules = statblockRollingDice(app, getSource(), offMap?.());
    const sides = rules ? advantageSidesFor(formula, rules) : [];
    const choices: RollChoice[] = [
      { label: t('dice.roll'), side: null, roll: () => roll(link, null) },
      ...sides.map((side): RollChoice => ({ label: SIDE_LABELS[side](), side, roll: () => roll(link, side) })),
    ];
    if (specOfText(formula, rules ? rollParseOptionsOf(rules) : {}).check) {
      choices.push({ label: t('dice.rollWithModifier'), side: null, roll: () => askModifier(link) });
      choices.push({ label: t('dice.contest.start'), side: null, roll: () => startPendingContest(app, sideOf(link), link, el) });
    }
    // A menu key or Shift+F10 is no right button: the menu hangs from the link.
    const box = link.getBoundingClientRect();
    openMenu(choices, event.button === 2 ? { x: event.clientX, y: event.clientY } : { x: box.left, y: box.bottom }, link);
  };

  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('contextmenu', onContextMenu);

  return () => {
    cleaned = true;
    cancelPendingContest(el);
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKeyDown);
    el.removeEventListener('contextmenu', onContextMenu);
  };
}

/** Shared attributes for a clickable dice span, used by DOM and React paths. */
export function diceLinkProps(matched: string): {
  className: string;
  'data-formula': string;
  role: string;
  tabIndex: number;
  'aria-label': string;
} {
  const formula = toRollFormula(matched);
  return {
    className: LINK_CLASS,
    'data-formula': formula,
    role: 'button',
    tabIndex: 0,
    'aria-label': t('dice.rollFormula', { formula }),
  };
}
