import type { Blockquote, PhrasingContent } from 'mdast';
import { calloutHead, type CalloutHead } from '../../protocol/noteLinks.ts';

/** A blockquote whose first line is a callout head: the head, the first paragraph's text after it, and that paragraph's other children. */
export interface SourceCallout {
	readonly head: CalloutHead;
	readonly afterHead: string;
	readonly others: readonly PhrasingContent[];
}

const GM_HEAD = /^\[!\s*gm(?:[\]|\s]|$)/i;

/**
 * Whether a blockquote may be a gm callout. Obsidian decides by the quote's first source line, whatever the
 * parser made of it (a setext heading, a definition), so that line is read from the source. Without positions
 * the first child is searched instead; either way, doubt means yes.
 */
export function mayBeGmCallout(node: Blockquote, source: string | undefined): boolean {
	const start = node.position?.start.offset;
	if (source === undefined || start === undefined) {
		const first = node.children[0];
		return first !== undefined && /\[!\s*gm|"!\s*gm/i.test(JSON.stringify(first, (key, value: unknown) => (key === 'position' ? undefined : value)));
	}
	const rest = source.slice(start);
	const end = rest.search(/[\r\n]/);
	return GM_HEAD.test((end < 0 ? rest : rest.slice(0, end)).replace(/^>?[ \t]*/, ''));
}

/** The callout a blockquote is, or null for a plain quote. */
export function calloutOf(node: Blockquote): SourceCallout | null {
	const paragraph = node.children[0];
	if (paragraph?.type !== 'paragraph') return null;
	const first = paragraph.children[0];
	if (first?.type !== 'text') return null;
	const newline = first.value.indexOf('\n');
	const line = newline < 0 ? first.value : first.value.slice(0, newline);
	const head = calloutHead(line);
	if (head === null) return null;
	let end = line.indexOf(']') + 1;
	if (line.charAt(end) === '+' || line.charAt(end) === '-') end++;
	return { head, afterHead: first.value.slice(end).replace(/^[ \t]+/, ''), others: paragraph.children.slice(1) };
}

/** Splits phrasing at the first line break: what lies before it (a callout's title) and after it. */
export function splitAtLine(nodes: readonly PhrasingContent[]): { before: PhrasingContent[]; after: PhrasingContent[] } {
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]!;
		if (node.type === 'break') return { before: nodes.slice(0, index), after: nodes.slice(index + 1) };
		if (node.type === 'text') {
			const newline = node.value.indexOf('\n');
			if (newline < 0) continue;
			const before = nodes.slice(0, index);
			const after = nodes.slice(index + 1);
			const head = node.value.slice(0, newline);
			const tail = node.value.slice(newline + 1).replace(/^[ \t]+/, '');
			if (head !== '') before.push({ type: 'text', value: head });
			if (tail !== '') after.unshift({ type: 'text', value: tail });
			return { before, after };
		}
	}
	return { before: [...nodes], after: [] };
}

/** The plain text of phrasing: formatting and links give their text, code its value, images nothing. */
export function plainText(nodes: readonly PhrasingContent[]): string {
	let out = '';
	for (const node of nodes) {
		if (node.type === 'text' || node.type === 'inlineCode') out += node.value;
		else if (node.type === 'break') out += ' ';
		else if ('children' in node) out += plainText(node.children);
	}
	return out.replace(/\s+/g, ' ').trim();
}
