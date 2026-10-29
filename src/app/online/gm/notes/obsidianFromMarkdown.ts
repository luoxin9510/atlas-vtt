import type { Extension as FromMarkdownExtension, CompileContext } from 'mdast-util-from-markdown';
import type { Node, Nodes } from 'mdast';
import type { Token } from 'micromark-util-types';

export interface WikiLink extends Node {
	type: 'wikiLink';
	/** The text before the first `|`, including a `#heading` or `#^block` part. */
	target: string;
	/** Everything after the first `|` (may contain more `|`), or null without one. */
	alias: string | null;
	embed: boolean;
}

/** A `%%comment%%`. Its content is never kept. */
export interface ObsidianComment extends Node {
	type: 'obsidianComment';
	closed: boolean;
}

declare module 'mdast' {
	interface PhrasingContentMap {
		wikiLink: WikiLink;
		obsidianComment: ObsidianComment;
	}
	interface BlockContentMap {
		obsidianComment: ObsidianComment;
	}
	interface RootContentMap {
		wikiLink: WikiLink;
		obsidianComment: ObsidianComment;
	}
}

const BACKSLASH = '\\';
const PIPE = '|';

/** Splits `target|alias`; a `\|` (the way a table cell holds a pipe) separates like `|`. */
export function splitWikiLink(raw: string): { target: string; alias: string | null } {
	let target = '';
	for (let index = 0; index < raw.length; index++) {
		const char = raw.charAt(index);
		if (char === PIPE) return { target, alias: unescapePipes(raw.slice(index + 1)) };
		if (char === BACKSLASH && raw.charAt(index + 1) === PIPE) {
			return { target, alias: unescapePipes(raw.slice(index + 2)) };
		}
		target += char;
	}
	return { target, alias: null };
}

function unescapePipes(text: string): string {
	let out = '';
	for (let index = 0; index < text.length; index++) {
		const char = text.charAt(index);
		if (char === BACKSLASH && text.charAt(index + 1) === PIPE) continue;
		out += char;
	}
	return out;
}

function top(context: CompileContext): Nodes | undefined {
	const node = context.stack[context.stack.length - 1];
	return node as Nodes | undefined;
}

function enterWikiLink(this: CompileContext, token: Token): void {
	this.enter({ type: 'wikiLink', target: '', alias: null, embed: false }, token);
}

function enterEmbedMarker(this: CompileContext): void {
	const node = top(this);
	if (node?.type === 'wikiLink') node.embed = true;
}

function exitWikiLinkData(this: CompileContext, token: Token): void {
	const node = top(this);
	if (node?.type !== 'wikiLink') return;
	const { target, alias } = splitWikiLink(this.sliceSerialize(token));
	node.target = target;
	node.alias = alias;
}

function enterComment(this: CompileContext, token: Token): void {
	this.enter({ type: 'obsidianComment', closed: false }, token);
}

function exitCommentClose(this: CompileContext): void {
	const node = top(this);
	if (node?.type === 'obsidianComment') node.closed = true;
}

function exitNode(this: CompileContext, token: Token): void {
	this.exit(token);
}

export function obsidianFromMarkdown(): FromMarkdownExtension {
	return {
		enter: {
			wikiLink: enterWikiLink,
			wikiLinkEmbedMarker: enterEmbedMarker,
			obsidianComment: enterComment,
		},
		exit: {
			wikiLinkData: exitWikiLinkData,
			wikiLink: exitNode,
			obsidianCommentClose: exitCommentClose,
			obsidianComment: exitNode,
		},
	};
}
