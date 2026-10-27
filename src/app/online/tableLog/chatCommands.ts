import { commandMode, GM_AUTHOR, inlineMarks, MAX_FLAVOR, MAX_FORMULA, MAX_INLINE_ROLLS, shownLine, type RollMode, type TablePerson } from '../protocol/index.ts';
import { commandNamed, type CommandInfo } from './commandList.ts';
import type { ChatDraft, RollDraft, SpeakerOption } from './panelTypes.ts';
import { t } from '../../i18n';

/** What a command is read against: who the viewer is, who is at the table and what the viewer chose. */
export interface CommandContext {
  readonly self: string | null;
  readonly people: readonly TablePerson[];
  readonly rollMode: RollMode;
  /** The speaker chosen; null where the panel offers none. */
  readonly speaker: SpeakerOption | null;
  /** Who `/reply` whispers to: the people of the newest whisper the viewer was sent. */
  readonly lastWhisper: readonly string[] | null;
  /** Who every message goes to until it is cleared. */
  readonly whisperTo: readonly string[] | null;
}

/** What the viewer typed means: a message, a roll, an audience to keep, the help, an error to show, or nothing. */
export type ComposerIntent =
  | { readonly kind: 'say'; readonly draft: Omit<ChatDraft, 'reply'> }
  | { readonly kind: 'roll'; readonly draft: RollDraft }
  | { readonly kind: 'audience'; readonly to: readonly string[] }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'nothing' };

const COMMAND = /^\/([a-z]\S*)/i;

const error = (message: string): ComposerIntent => ({ kind: 'error', message });

/** The chosen speaker's key where it is a token: what speaks in character. */
function tokenKey(context: CommandContext): string | undefined {
  return context.speaker?.kind === 'token' ? context.speaker.key : undefined;
}

/** A message, unless a roll written into it cannot be sent. */
function said(text: string, fields: Omit<ChatDraft, 'text' | 'reply'>): ComposerIntent {
  if (inlineMarks(text) === null) return error(t('onlineLog.error.tooManyRolls', { max: MAX_INLINE_ROLLS }));
  return { kind: 'say', draft: { text, ...fields } };
}

/** Said as the viewer says things now: in character where a token speaks, to the kept audience where there is one. */
function plain(text: string, context: CommandContext, to: readonly string[] | null = context.whisperTo): ComposerIntent {
  const speaker = tokenKey(context);
  return said(text, { ...(speaker !== undefined && { style: 'ic', speaker }), ...(to !== null && { to }) });
}

/** `formula # flavor` rolled in a mode. */
function rolled(rest: string, spelling: string, mode: RollMode, context: CommandContext): ComposerIntent {
  const hash = rest.indexOf('#');
  const formula = (hash === -1 ? rest : rest.slice(0, hash)).replace(/\s+/g, ' ').trim();
  const flavorText = hash === -1 ? '' : rest.slice(hash + 1).trim();
  if (formula === '') return error(t('onlineLog.error.writeDice', { spelling }));
  if (formula.length > MAX_FORMULA) return error(t('onlineLog.error.formulaLong'));
  const flavor = flavorText === '' ? undefined : shownLine(flavorText, MAX_FLAVOR);
  if (flavor === null) return error(t('onlineLog.error.flavorLong', { max: MAX_FLAVOR }));
  const speaker = tokenKey(context);
  return { kind: 'roll', draft: { formula, mode, ...(flavor !== undefined && { flavor }), ...(speaker !== undefined && { speaker }) } };
}

/** The id a name names: `gm` or `dm` for the GM, else the one person of that exact name, any case. */
function resolveName(name: string, people: readonly TablePerson[]): string | { readonly problem: string } {
  const lower = name.toLocaleLowerCase();
  if (lower === 'gm' || lower === 'dm') return GM_AUTHOR;
  const found = people.filter((person) => person.away !== true && person.name.toLocaleLowerCase() === lower);
  if (found.length === 1) return found[0]!.id;
  return { problem: found.length === 0 ? t('onlineLog.error.nobody', { name }) : t('onlineLog.error.several', { name }) };
}

/** The names and the message of `/w Kara text` or `/w [Kara Thorn, GM] text`. */
function whisperParts(rest: string): { readonly names: readonly string[]; readonly message: string; readonly bracketed: boolean } | null {
  if (!rest.startsWith('[')) {
    const [, name = '', message = ''] = /^(\S*)\s*([\s\S]*)$/.exec(rest) ?? [];
    return { names: name === '' ? [] : [name], message, bracketed: false };
  }
  const close = rest.indexOf(']');
  if (close === -1) return null;
  const names = rest.slice(1, close).split(',').map((name) => name.trim()).filter((name) => name !== '');
  return { names, message: rest.slice(close + 1).trim(), bracketed: true };
}

/** A message to `to` without the viewer; with no message, the audience to keep. */
function whispered(to: readonly string[], message: string, context: CommandContext): ComposerIntent {
  const others = [...new Set(to)].filter((id) => id !== context.self);
  if (others.length === 0) return error(t('onlineLog.error.whisperSelf'));
  return message === '' ? { kind: 'audience', to: others } : plain(message, context, others);
}

function whisper(rest: string, spelling: string, context: CommandContext): ComposerIntent {
  const parts = whisperParts(rest);
  if (parts === null) return error(t('onlineLog.error.closeNames'));
  if (parts.names.length === 0) return error(t('onlineLog.error.writeName', { spelling }));
  const ids: string[] = [];
  for (const name of parts.names) {
    const id = resolveName(name, context.people);
    if (typeof id !== 'string') return error(parts.bracketed ? id.problem : t('onlineLog.error.spaceNames', { problem: id.problem, spelling }));
    ids.push(id);
  }
  return whispered(ids, parts.message, context);
}

function command(info: CommandInfo, spelling: string, rest: string, context: CommandContext): ComposerIntent {
  const mode = commandMode(info.name);
  if (mode !== null) return rolled(rest, spelling, info.name === 'r' ? context.rollMode : mode, context);
  switch (info.name) {
    case 'w':
      return whisper(rest, spelling, context);
    case 'gm':
      return context.self === GM_AUTHOR ? error(t('onlineLog.error.youAreGm')) : whispered([GM_AUTHOR], rest, context);
    case 'players': {
      const players = context.people.filter((person) => person.away !== true).map((person) => person.id).filter((id) => id !== context.self);
      return players.length === 0 ? error(t('onlineLog.error.noPlayers')) : whispered(players, rest, context);
    }
    case 'reply':
      return context.lastWhisper === null ? error(t('onlineLog.error.nobodyWhispered')) : replyAudience(context.lastWhisper, rest, context);
    case 'ic': {
      const speaker = tokenKey(context);
      if (speaker === undefined) return error(t('onlineLog.error.chooseToken'));
      if (rest === '') return error(t('onlineLog.error.writeIc'));
      return said(rest, { style: 'ic', speaker, ...(context.whisperTo !== null && { to: context.whisperTo }) });
    }
    case 'ooc':
      return rest === '' ? error(t('onlineLog.error.writeOoc')) : said(rest, context.whisperTo === null ? {} : { to: context.whisperTo });
    case 'em': {
      if (rest === '') return error(t('onlineLog.error.writeEm', { spelling }));
      const speaker = tokenKey(context);
      return said(rest, { style: 'emote', ...(speaker !== undefined && { speaker }), ...(context.whisperTo !== null && { to: context.whisperTo }) });
    }
    default:
      return { kind: 'help' };
  }
}

/**
 * What a text typed into the message field means, by Foundry VTT's chat commands: a command is a
 * slash and a word at the start, in any case, with a space before what follows it. Anything else
 * is a message. Nothing here is sent; an error names what is wrong.
 */
export function parseComposerInput(text: string, context: CommandContext): ComposerIntent {
  const typed = text.trim();
  if (typed === '') return { kind: 'nothing' };
  const match = COMMAND.exec(typed);
  if (match === null) return plain(typed, context);
  const spelling = match[1]!;
  const info = commandNamed(spelling);
  if (info === null) return error(t('onlineLog.error.noCommand', { spelling }));
  return command(info, spelling.toLowerCase(), typed.slice(match[0].length).trim(), context);
}

/** The speaker a key names among the options, else the first: the viewer as themselves. */
export function chosenSpeaker(speakers: readonly SpeakerOption[], key: string | null): SpeakerOption | null {
  return speakers.find((option) => option.key === key) ?? speakers[0] ?? null;
}

/** `/reply` to the people of the newest whisper who are still at the table. */
function replyAudience(last: readonly string[], rest: string, context: CommandContext): ComposerIntent {
  const gone = new Set(context.people.filter((person) => person.away === true).map((person) => person.id));
  const here = last.filter((id) => !gone.has(id));
  return here.length === 0 ? error(t('onlineLog.error.whisperGone')) : whispered(here, rest, context);
}
