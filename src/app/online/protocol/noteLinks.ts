import { parseAsset, type AssetRef } from './asset.ts';
import { NOTE_ID_PATTERN } from './fork.ts';

const NOTE_PREFIX = 'atlas-note:';
const ASSET_PREFIX = 'atlas-asset:';
const ASSET_QUERY = /^([0-9a-f]{64})\?size=([0-9]{1,10})&mime=([a-z]+\/[a-z0-9.+-]+)$/;

/** The in-app link to the shared note `id`. */
export const noteHref = (id: string): string => `${NOTE_PREFIX}${id}`;

/** The note id a link names, or null for any other link. */
export function noteIdOf(href: string): string | null {
  if (!href.startsWith(NOTE_PREFIX)) return null;
  const id = href.slice(NOTE_PREFIX.length);
  return NOTE_ID_PATTERN.test(id) ? id : null;
}

/** The image source for a note image the player fetches by hash. */
export const assetImageHref = (ref: AssetRef): string => `${ASSET_PREFIX}${ref.hash}?size=${ref.size}&mime=${ref.mime}`;

/** The image a source names, or null for anything else (only image types). */
export function assetImageOf(href: string): AssetRef | null {
  if (!href.startsWith(ASSET_PREFIX)) return null;
  const match = ASSET_QUERY.exec(href.slice(ASSET_PREFIX.length));
  if (!match) return null;
  return parseAsset({ hash: match[1], size: Number(match[2]), mime: match[3] });
}

/** Whether `href` is an absolute `https:` URL without credentials. */
export function isHttpsUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** The standard Obsidian callout types; any other becomes a plain quote. */
export const CALLOUT_TYPES: ReadonlySet<string> = new Set([
  'note', 'abstract', 'summary', 'tldr', 'info', 'todo', 'tip', 'hint', 'important', 'success', 'check', 'done',
  'question', 'help', 'faq', 'warning', 'caution', 'attention', 'failure', 'fail', 'missing', 'danger', 'error', 'bug',
  'example', 'quote', 'cite',
]);

function isTypeCharacter(character: string): boolean {
  return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character === '-' || character === '_';
}

/** What a callout's first line says. */
export interface CalloutHead {
  readonly type: string;
  readonly fold: '' | '+' | '-';
  readonly title: string;
}

/** The head line of a callout (`[!type]+ title`), or null when the line is none. */
export function calloutHead(line: string): CalloutHead | null {
  if (!line.startsWith('[!')) return null;
  let i = 2;
  while (i < line.length && isTypeCharacter(line[i]!)) i++;
  if (i === 2 || line[i] !== ']') return null;
  const type = line.slice(2, i).toLowerCase();
  i++;
  let fold: '' | '+' | '-' = '';
  if (line[i] === '+' || line[i] === '-') {
    fold = line[i] as '+' | '-';
    i++;
  }
  return { type, fold, title: line.slice(i).trim() };
}
