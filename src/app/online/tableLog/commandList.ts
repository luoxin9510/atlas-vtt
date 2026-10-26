import { t } from '../../i18n';
/** A command of the message field, as the suggestions and the help list it. */
export interface CommandInfo {
  /** Its shortest spelling, without the slash. */
  readonly name: string;
  /** Its other spellings. */
  readonly aliases: readonly string[];
  /** What comes after it, as an example. */
  readonly usage: string;
  readonly description: string;
  /** Does what it does with nothing after it: Enter on it sends instead of completing it. */
  readonly standsAlone?: true;
}

/** Foundry VTT's chat commands, in the order they are offered. */
export const COMMANDS: readonly CommandInfo[] = [
  { name: 'r', aliases: ['roll'], usage: '1d20+5 # Attack', description: t('onlineLog.cmd.r') },
  { name: 'pr', aliases: ['publicroll'], usage: '1d20', description: t('onlineLog.cmd.pr') },
  { name: 'gmr', aliases: ['gmroll'], usage: '1d20', description: t('onlineLog.cmd.gmr') },
  { name: 'br', aliases: ['broll', 'blindr', 'blindroll'], usage: '1d20', description: t('onlineLog.cmd.br') },
  { name: 'sr', aliases: ['selfroll'], usage: '1d20', description: t('onlineLog.cmd.sr') },
  { name: 'w', aliases: ['whisper'], usage: 'Kara Hello, or /w [Kara, GM] Hello', description: t('onlineLog.cmd.w') },
  { name: 'gm', aliases: [], usage: 'Hello', description: t('onlineLog.cmd.gm'), standsAlone: true },
  { name: 'players', aliases: [], usage: 'Hello', description: t('onlineLog.cmd.players'), standsAlone: true },
  { name: 'reply', aliases: [], usage: 'Hello', description: t('onlineLog.cmd.reply'), standsAlone: true },
  { name: 'ic', aliases: [], usage: 'Hello', description: t('onlineLog.cmd.ic') },
  { name: 'ooc', aliases: [], usage: 'Hello', description: t('onlineLog.cmd.ooc') },
  { name: 'em', aliases: ['emote', 'me'], usage: 'draws her sword', description: t('onlineLog.cmd.em') },
  { name: 'help', aliases: [], usage: '', description: t('onlineLog.cmd.help'), standsAlone: true },
];

/** The command a spelling names (any case), or null. */
export function commandNamed(word: string): CommandInfo | null {
  const spelling = word.toLowerCase();
  return COMMANDS.find((command) => command.name === spelling || command.aliases.includes(spelling)) ?? null;
}
