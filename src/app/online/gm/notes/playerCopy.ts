import type { BlockContent, List, ListItem, Nodes, PhrasingContent, Root, RootContent, Table, TableCell, TableRow } from 'mdast';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import { assetImageHref, assetImageOf, isHttpsUrl, noteHref, CALLOUT_TYPES } from '../../protocol/noteLinks.ts';
import { htmlEnd, isBlank, isOpenHtmlComment, stripBlockId, trimEdges, withoutBrokenWikiLinks } from './copyText';
import { calloutOf, plainText, splitAtLine } from './copyCallouts';
import { hasScheme, imageCaption, namesTheFile, resolveWikiLink, vaultPath, type CopyTargets } from './copyLinks';
import { PLAIN_CODE_LANGUAGES } from './plainLanguages';

export type { CopyTargets } from './copyLinks';

/** What players get of a note: its Markdown, and the images it names (hash to the path the share serves it from). */
export interface PlayerCopy {
	readonly markdown: string;
	readonly images: ReadonlyMap<string, string>;
}

interface Copy {
	readonly targets: CopyTargets;
	/** Every image resolved on the way (hash to linkpath); only those the output holds are handed out. */
	readonly images: Map<string, string>;
	/** Set by an unclosed comment: nothing after it, in document order, is copied. */
	cut: boolean;
}

type Align = 'left' | 'right' | 'center' | null;

/** A value that holds `%%` is an unclosed comment in the making (an autolink, an escape): the copy ends before it. */
function safe(value: string, copy: Copy): boolean {
	if (!value.includes('%%')) return true;
	copy.cut = true;
	return false;
}

function hasOpenComment(node: Nodes): boolean {
	if (node.type === 'obsidianComment') return !node.closed;
	return 'children' in node && (node.children as Nodes[]).some(hasOpenComment);
}

/** Drops a node with everything in it; an unclosed comment inside it still ends the copy. */
function drop(node: Nodes, copy: Copy): [] {
	if (hasOpenComment(node)) copy.cut = true;
	return [];
}

async function inline(node: PhrasingContent, copy: Copy, inLink: boolean): Promise<PhrasingContent[]> {
	switch (node.type) {
		case 'inlineCode':
			return [{ type: 'inlineCode', value: node.value }];
		case 'break':
			return [{ type: 'break' }];
		case 'emphasis':
		case 'strong':
		case 'delete': {
			const children = await phrasing(node.children, copy, inLink);
			return children.length === 0 ? [] : [{ type: node.type, children }];
		}
		case 'linkReference':
			return phrasing(node.children, copy, inLink);
		case 'link':
			return markdownLink(node.url, plainText(node.children), await phrasing(node.children, copy, true), copy, inLink);
		case 'image':
			return markdownImage(node.url, node.alt ?? '', copy);
		case 'wikiLink':
			return wikiLink(node, copy, inLink);
		case 'obsidianComment':
			if (!node.closed) copy.cut = true;
			return [];
		default:
			return drop(node, copy);
	}
}

async function phrasing(nodes: readonly PhrasingContent[], copy: Copy, inLink: boolean): Promise<PhrasingContent[]> {
	const out: PhrasingContent[] = [];
	/** Inside a `[[` the parser did not take as a link: everything up to its `]]` is the typed target. */
	let open = false;
	for (let index = 0; index < nodes.length; index++) {
		if (copy.cut) break;
		const node = nodes[index]!;
		if (node.type === 'html') {
			const end = htmlEnd(nodes, index);
			for (const hidden of nodes.slice(index, end)) {
				if (isOpenHtmlComment(hidden)) copy.cut = true;
				drop(hidden, copy);
			}
			index = end - 1;
			continue;
		}
		if (node.type === 'text') {
			const cutAt = node.value.indexOf('<!--');
			if (cutAt >= 0) copy.cut = true;
			const result = withoutBrokenWikiLinks(cutAt < 0 ? node.value : node.value.slice(0, cutAt), open);
			open = result.open;
			if (result.text !== '' && safe(result.text, copy)) out.push({ type: 'text', value: result.text });
			continue;
		}
		if (open) {
			drop(node, copy);
			continue;
		}
		out.push(...(await inline(node, copy, inLink)));
	}
	return out;
}

function noteLink(id: string, text: string, copy: Copy, inLink: boolean): PhrasingContent[] {
	if (!safe(text, copy)) return [];
	const label: PhrasingContent = { type: 'text', value: text };
	return inLink ? [label] : [{ type: 'link', url: noteHref(id), title: null, children: [label] }];
}

/** Whether a link shows its own address: an autolink, a literal one, a bare email or a `www.` address (GFM adds `http://` or `mailto:`). */
function showsItsUrl(text: string, url: string): boolean {
	const shown = text.trim().toLowerCase();
	const target = url.trim().toLowerCase();
	return shown === target || `mailto:${shown}` === target || `http://${shown}` === target || `https://${shown}` === target;
}

async function markdownLink(url: string, text: string, children: PhrasingContent[], copy: Copy, inLink: boolean): Promise<PhrasingContent[]> {
	if (hasScheme(url)) {
		if (!isHttpsUrl(url) && showsItsUrl(text, url)) return [];
		if (isHttpsUrl(url) && !safe(url, copy)) return [];
		if (inLink || children.length === 0 || !isHttpsUrl(url)) return children;
		return [{ type: 'link', url, title: null, children }];
	}
	const path = vaultPath(url);
	const note = path === null ? null : copy.targets.note(path);
	if (note === null) return children;
	if (children.length > 0 && !inLink) return [{ type: 'link', url: noteHref(note.id), title: null, children }];
	return children.length > 0 ? children : noteLink(note.id, note.title, copy, inLink);
}

function imageNode(ref: Parameters<typeof assetImageHref>[0], path: string, written: string, copy: Copy): PhrasingContent[] {
	const href = assetImageHref(ref);
	if (assetImageOf(href) === null) return [];
	const caption = namesTheFile(written, path) ? '' : written;
	if (!safe(caption, copy)) return [];
	if (!copy.images.has(ref.hash)) copy.images.set(ref.hash, path);
	return [{ type: 'image', url: href, alt: caption, title: null }];
}

async function markdownImage(url: string, alt: string, copy: Copy): Promise<PhrasingContent[]> {
	if (hasScheme(url)) return [];
	const path = vaultPath(url);
	const ref = path === null ? null : await copy.targets.image(path);
	if (path === null || ref === null) return [];
	return imageNode(ref, path, imageCaption(alt), copy);
}

async function wikiLink(node: Extract<PhrasingContent, { type: 'wikiLink' }>, copy: Copy, inLink: boolean): Promise<PhrasingContent[]> {
	const outcome = await resolveWikiLink(node, copy.targets);
	switch (outcome.kind) {
		case 'note':
			return noteLink(outcome.id, outcome.text, copy, inLink);
		case 'image':
			return imageNode(outcome.ref, outcome.path, outcome.caption, copy);
		case 'text':
			return safe(outcome.text, copy) ? [{ type: 'text', value: outcome.text }] : [];
		default:
			return [];
	}
}

async function textBlock(children: readonly PhrasingContent[], copy: Copy): Promise<PhrasingContent[] | null> {
	const out = await phrasing(children, copy, false);
	stripBlockId(out);
	const trimmed = trimEdges(out);
	return isBlank(trimmed) ? null : trimmed;
}

async function blocks(nodes: readonly RootContent[], copy: Copy): Promise<BlockContent[]> {
	const out: BlockContent[] = [];
	for (const node of nodes) {
		if (copy.cut) break;
		out.push(...(await block(node, copy)));
	}
	return out;
}

async function block(node: RootContent, copy: Copy): Promise<BlockContent[]> {
	switch (node.type) {
		case 'heading': {
			const children = await textBlock(node.children, copy);
			return children === null ? [] : [{ type: 'heading', depth: node.depth >= 1 && node.depth <= 6 ? node.depth : 6, children }];
		}
		case 'paragraph': {
			const children = await textBlock(node.children, copy);
			return children === null ? [] : [{ type: 'paragraph', children }];
		}
		case 'blockquote':
			return quote(node, copy);
		case 'list':
			return list(node, copy);
		case 'table':
			return table(node, copy);
		case 'thematicBreak':
			return [{ type: 'thematicBreak' }];
		case 'code': {
			const language = (node.lang ?? '').trim().toLowerCase();
			if (language !== '' && !PLAIN_CODE_LANGUAGES.has(language)) return [];
			return [{ type: 'code', lang: null, meta: null, value: node.value }];
		}
		case 'obsidianComment':
			if (!node.closed) copy.cut = true;
			return [];
		default:
			return drop(node, copy);
	}
}

async function quote(node: Extract<RootContent, { type: 'blockquote' }>, copy: Copy): Promise<BlockContent[]> {
	const callout = calloutOf(node);
	if (callout === null) {
		const children = await blocks(node.children, copy);
		return children.length === 0 ? [] : [{ type: 'blockquote', children }];
	}
	if (callout.head.type === 'gm') return drop(node, copy);
	const rest: PhrasingContent[] = callout.afterHead === '' ? [...callout.others] : [{ type: 'text', value: callout.afterHead }, ...callout.others];
	const { before, after } = splitAtLine(await phrasing(rest, copy, false));
	stripBlockId(after.length > 0 ? after : before);
	trimEdges(after);
	const title = plainText(before);
	const children: BlockContent[] = [];
	const known = CALLOUT_TYPES.has(callout.head.type);
	if (known) {
		const head = `[!${callout.head.type}]`;
		children.push({ type: 'paragraph', children: title === '' ? [{ type: 'html', value: head }] : [{ type: 'html', value: `${head} ` }, { type: 'text', value: title }] });
	} else if (title !== '') {
		children.push({ type: 'paragraph', children: [{ type: 'text', value: title }] });
	}
	if (!isBlank(after)) children.push({ type: 'paragraph', children: after });
	children.push(...(await blocks(node.children.slice(1), copy)));
	return children.length === 0 ? [] : [{ type: 'blockquote', children }];
}

async function list(node: List, copy: Copy): Promise<BlockContent[]> {
	const items: ListItem[] = [];
	for (const item of node.children) {
		if (copy.cut) break;
		const children = await blocks(item.children, copy);
		if (children.length > 0) items.push({ type: 'listItem', spread: false, checked: item.checked === true ? true : item.checked === false ? false : null, children });
	}
	if (items.length === 0) return [];
	const start = typeof node.start === 'number' && Number.isInteger(node.start) && node.start >= 0 ? node.start : 1;
	return [{ type: 'list', ordered: node.ordered === true, start: node.ordered === true ? start : null, spread: false, children: items }];
}

async function table(node: Table, copy: Copy): Promise<BlockContent[]> {
	const rows: TableRow[] = [];
	for (const row of node.children) {
		if (copy.cut) break;
		const cells: TableCell[] = [];
		for (const cell of row.children) {
			if (copy.cut) break;
			cells.push({ type: 'tableCell', children: trimEdges(await phrasing(cell.children, copy, false)) });
		}
		if (cells.length > 0) rows.push({ type: 'tableRow', children: cells });
	}
	if (rows.length === 0) return [];
	const align = (node.align ?? []).map((value): Align => (value === 'left' || value === 'right' || value === 'center' ? value : null));
	return [{ type: 'table', align, children: rows }];
}

/** The images the output tree holds, found by the hashes of its image nodes. */
function imagesIn(node: Nodes, found: ReadonlyMap<string, string>): Map<string, string> {
	const used = new Map<string, string>();
	const visit = (current: Nodes): void => {
		if (current.type === 'image') {
			const hash = assetImageOf(current.url)?.hash;
			const path = hash === undefined ? undefined : found.get(hash);
			if (hash !== undefined && path !== undefined) used.set(hash, path);
		}
		if ('children' in current) for (const child of current.children) visit(child);
	};
	visit(node);
	return used;
}

/**
 * The copy of a parsed note that players get: a new tree built from the allowed nodes only
 * (anything else is dropped with its content), serialised to Markdown. The parsed tree is not touched.
 */
export async function copyForPlayers(tree: Root, targets: CopyTargets): Promise<PlayerCopy> {
	const copy: Copy = { targets, images: new Map(), cut: false };
	const children = await blocks(tree.children, copy);
	const root: Root = { type: 'root', children };
	const markdown = children.length === 0 ? '' : toMarkdown(root, { extensions: [gfmToMarkdown()] });
	return { markdown, images: imagesIn(root, copy.images) };
}
