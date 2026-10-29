import type { AssetRef } from '../../protocol/asset.ts';
import type { WikiLink } from './obsidianFromMarkdown';

/** What the share knows: only shared notes resolve as notes, only vault images as images. */
export interface CopyTargets {
	note(linkpath: string): { id: string; title: string } | null;
	image(linkpath: string): Promise<AssetRef | null>;
}

/** How a wikilink or embed reads for players. */
export type WikiOutcome =
	| { kind: 'note'; id: string; text: string }
	| { kind: 'image'; ref: AssetRef; path: string; caption: string }
	| { kind: 'text'; text: string }
	| { kind: 'none' };

const HEADING_SEPARATOR = ' › ';

function isLetter(char: string): boolean {
	return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

/** Whether `url` is external: it has a `scheme:` (any single letter too, like `C:`) or starts with `//`. */
export function hasScheme(url: string): boolean {
	if (url.startsWith('//')) return true;
	if (url.length === 0 || !isLetter(url.charAt(0))) return false;
	for (let index = 1; index < url.length; index++) {
		const char = url.charAt(index);
		if (char === ':') return true;
		if (!(isLetter(char) || (char >= '0' && char <= '9') || char === '+' || char === '.' || char === '-')) return false;
	}
	return false;
}

/** The vault path a Markdown link or image names (`#…` cut, percent-decoded), or null when it names none. */
export function vaultPath(url: string): string | null {
	const hash = url.indexOf('#');
	const raw = hash < 0 ? url : url.slice(0, hash);
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return null;
	}
	const path = decoded.trim();
	return path === '' ? null : path;
}

function isSize(part: string): boolean {
	const trimmed = part.trim();
	let index = 0;
	while (index < trimmed.length && trimmed.charAt(index) >= '0' && trimmed.charAt(index) <= '9') index++;
	if (index === 0) return false;
	if (index === trimmed.length) return true;
	if (trimmed.charAt(index) !== 'x') return false;
	const second = index + 1;
	index = second;
	while (index < trimmed.length && trimmed.charAt(index) >= '0' && trimmed.charAt(index) <= '9') index++;
	return index > second && index === trimmed.length;
}

/** The caption an image alias carries: its first part that is neither empty nor a size. Empty when the author wrote none. */
export function imageCaption(alias: string | null): string {
	if (alias === null) return '';
	for (const part of alias.split('|')) {
		const trimmed = part.trim();
		if (trimmed !== '' && !isSize(trimmed)) return trimmed;
	}
	return '';
}

/** The visible heading text of a `#a#b` fragment; empty for none or a block reference (`#^id`), which is never shown. */
function headingOf(fragment: string): string {
	if (fragment.startsWith('^')) return '';
	return fragment.split('#').map((part) => part.trim()).filter((part) => part !== '' && !part.startsWith('^')).join(HEADING_SEPARATOR);
}

/** Resolves a wikilink or wiki embed by the copy rules; never returns the typed target. */
export async function resolveWikiLink(node: WikiLink, targets: CopyTargets): Promise<WikiOutcome> {
	const hash = node.target.indexOf('#');
	const linkpath = (hash < 0 ? node.target : node.target.slice(0, hash)).trim();
	const heading = hash < 0 ? '' : headingOf(node.target.slice(hash + 1));
	if (node.embed) {
		if (linkpath === '') return { kind: 'none' };
		const ref = await targets.image(linkpath);
		if (ref !== null) return { kind: 'image', ref, path: linkpath, caption: imageCaption(node.alias) };
		const note = targets.note(linkpath);
		if (note === null) return { kind: 'none' };
		return { kind: 'note', id: note.id, text: heading === '' ? note.title : `${note.title}${HEADING_SEPARATOR}${heading}` };
	}
	const alias = node.alias !== null && node.alias.trim() !== '' ? node.alias.trim() : null;
	const note = linkpath === '' ? null : targets.note(linkpath);
	if (note !== null) {
		const fallback = heading === '' ? note.title : `${note.title}${HEADING_SEPARATOR}${heading}`;
		return { kind: 'note', id: note.id, text: alias ?? fallback };
	}
	return alias === null ? { kind: 'none' } : { kind: 'text', text: alias };
}

function safelyDecoded(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/** Percent-decoded up to three times, until it stops changing. */
function decodedFully(text: string): string {
	let current = text;
	for (let round = 0; round < 3; round++) {
		const next = safelyDecoded(current);
		if (next === current) break;
		current = next;
	}
	return current;
}

/** The form names are compared in: decoded, NFKC, lower case, runs of space, `_`, `.`, `-`, `/` and `\` as one space. */
function canonical(text: string): string {
	return decodedFully(text).normalize('NFKC').toLowerCase().replace(/[\s_.\-/\\]+/g, ' ').trim();
}

/** A caption that is only the file's name or path tells players the name: separators count alike, the extension and folders are optional. */
export function namesTheFile(caption: string, path: string): boolean {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const withoutExtension = (text: string): string => (text.lastIndexOf('.') > 0 ? text.slice(0, text.lastIndexOf('.')) : text);
	const names = [path, withoutExtension(path), name, withoutExtension(name)].map(canonical);
	return names.includes(canonical(caption));
}
