import React, { useContext } from 'react';
import type { App } from 'obsidian';
import { DiceText } from './DiceText';
import { hasInlineMarkup } from './inlineMarkdown';
import { StatblockMarkdown } from './StatblockMarkdown';
import { WholeValueRollContext } from './wholeValueRoll';

interface InlineTextProps {
  text: string;
  app?: App | undefined;
  sourcePath?: string | undefined;
  /** False where the text is shown as written (a renderer that draws no Markdown). */
  markdown?: boolean | undefined;
  /**
   * Whether its dice notation and bare bonuses roll on a click, as in every
   * value (a table cell, an ability's part); off for text that names rather
   * than describes, an ability's name ("+1 Longsword").
   */
  dice: boolean;
}

/**
 * Short text on a line of its own kind (an ability's name and parts, a table
 * cell): drawn through Markdown as a note draws it, links and marks included,
 * where it holds any, and as plain text otherwise, its dice linked alike.
 */
export function InlineText({ text, app, sourcePath, markdown = true, dice: wanted }: InlineTextProps): React.JSX.Element {
  // Inside a check link the whole value is the one roll
  const dice = wanted && !useContext(WholeValueRollContext);
  if (!markdown || !hasInlineMarkup(text)) return dice ? <DiceText text={text} /> : <>{text}</>;
  return <StatblockMarkdown text={text} app={app} sourcePath={sourcePath} dice={dice} />;
}
