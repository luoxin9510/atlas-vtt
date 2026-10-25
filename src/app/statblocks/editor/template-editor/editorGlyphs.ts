/**
 * The glyphs and plain names the template editor's side panes show for
 * blocks, field types and meanings. The catalogue names its icons as lucide
 * names; these are the components behind them.
 */

import {
  AlignLeft, CircleDot, CircleHelp, Code, Columns3, Dices, Gauge, Hash, Heading, Image, List, ListChecks, ListTree, Minus, PanelTop, ScrollText,
  SquareSplitHorizontal, SquareStack, Star, Subtitles, Table, Tags, Text, Type, type LucideIcon,
} from 'lucide-react';
import { blockSpec, type BlockIcon } from '../../model/blockCatalogue';
import type { BlockType, FieldType } from '../../model/templateTypes';
import { t } from '../../../i18n';

const BLOCK_GLYPHS: Readonly<Record<BlockIcon, LucideIcon>> = {
  heading: Heading, text: Text, hash: Hash, subtitles: Subtitles, list: List, table: Table, gauge: Gauge, image: Image,
  'square-stack': SquareStack, 'columns-3': Columns3, minus: Minus, code: Code, 'circle-help': CircleHelp, 'panel-top': PanelTop,
  'square-split-horizontal': SquareSplitHorizontal, 'list-checks': ListChecks,
};

export function blockGlyph(type: BlockType): LucideIcon {
  return BLOCK_GLYPHS[blockSpec(type).icon];
}

/** What a field holds, in the words the editor uses. */
export const FIELD_TYPE_LABELS: Readonly<Record<FieldType, string>> = {
  text: t('sbTemplate.fieldType.text'), markdown: t('sbTemplate.fieldType.markdown'), number: t('sbTemplate.fieldType.number'), rating: t('sbTemplate.fieldType.rating'), dice: t('sbTemplate.fieldType.dice'), choice: t('sbTemplate.fieldType.choice'),
  list: t('sbTemplate.fieldType.list'), scores: t('sbTemplate.fieldType.scores'), entries: t('sbTemplate.fieldType.entries'), pairs: t('sbTemplate.fieldType.pairs'), image: t('sbTemplate.fieldType.image'),
  spells: t('sbTemplate.fieldType.spells'), counters: t('sbTemplate.fieldType.counters'),
};

const FIELD_TYPE_GLYPHS: Readonly<Record<FieldType, LucideIcon>> = {
  text: Type, markdown: AlignLeft, number: Hash, rating: Star, dice: Dices, choice: CircleDot,
  list: Tags, scores: Table, entries: ScrollText, pairs: List, image: Image, spells: ListTree,
  counters: ListChecks,
};

export function fieldTypeGlyph(type: FieldType): LucideIcon {
  return FIELD_TYPE_GLYPHS[type];
}

