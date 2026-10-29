import type { Nodes, PhrasingContent } from 'mdast';

function isSpace(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isIdCharacter(char: string): boolean {
	return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char === '-';
}

/** The value without a trailing ` ^block-id` token, or null when it has none. */
function withoutBlockId(value: string): string | null {
	let end = value.length;
	while (end > 0 && isSpace(value.charAt(end - 1))) end--;
	let start = end;
	while (start > 0 && isIdCharacter(value.charAt(start - 1))) start--;
	if (start === end || start === 0 || value.charAt(start - 1) !== '^') return null;
	const caret = start - 1;
	if (caret > 0 && !isSpace(value.charAt(caret - 1))) return null;
	return value.slice(0, caret).trimEnd();
}

export function stripBlockId(nodes: PhrasingContent[]): void {
	const last = nodes[nodes.length - 1];
	if (last?.type !== 'text') return;
	const stripped = withoutBlockId(last.value);
	if (stripped === null) return;
	if (stripped === '') nodes.pop();
	else last.value = stripped;
}

/** Trims the whitespace at both ends of phrasing (a serialised edge space would turn into an entity). */
export function trimEdges(nodes: PhrasingContent[]): PhrasingContent[] {
	const first = nodes[0];
	if (first?.type === 'text') first.value = first.value.trimStart();
	const last = nodes[nodes.length - 1];
	if (last?.type === 'text') last.value = last.value.trimEnd();
	return nodes.filter((node) => node.type !== 'text' || node.value !== '');
}

export function isBlank(nodes: readonly PhrasingContent[]): boolean {
	return nodes.every((node) => node.type === 'text' && node.value.trim() === '');
}


const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'input', 'wbr', 'area', 'base', 'col', 'embed', 'link', 'meta', 'source', 'track']);

/** The name of an inline `<tag …>` (lowercase; a leading `/` marks a closing tag), or null for comments, declarations and self-closing tags. */
function tagOf(value: string): string | null {
	if (!value.startsWith('<') || value.endsWith('/>')) return null;
	let index = 1;
	let name = '';
	if (value.charAt(index) === '/') {
		name = '/';
		index++;
	}
	while (index < value.length && /[A-Za-z0-9-]/.test(value.charAt(index))) name += value.charAt(index++);
	return name === '' || name === '/' ? null : name.toLowerCase();
}

/**
 * Where the raw HTML starting at `start` ends: what lies between an opening tag and its closing tag is
 * hidden with them (a `<span style="display:none">` hides its text), and an opening tag never closed hides
 * the rest of its parent. Comments, void and self-closing tags stand alone.
 */
export function htmlEnd(nodes: readonly PhrasingContent[], start: number): number {
	const first = nodes[start];
	const name = first?.type === 'html' ? tagOf(first.value) : null;
	if (name === null || name.startsWith('/') || VOID_TAGS.has(name)) return start + 1;
	let depth = 1;
	for (let index = start + 1; index < nodes.length; index++) {
		const node = nodes[index]!;
		if (node.type !== 'html') continue;
		const other = tagOf(node.value);
		if (other === name) depth++;
		else if (other === `/${name}` && --depth === 0) return index + 1;
	}
	return nodes.length;
}

/**
 * Drops each `[[` up to its `]]` (or, with `open` set on return, to the end of the text): a wikilink the parser
 * did not take must not show its typed target. `open` says the text starts inside such a `[[`. A `!` before it goes too.
 */
export function withoutBrokenWikiLinks(value: string, open: boolean): { text: string; open: boolean } {
	let text = '';
	let position = 0;
	if (open) {
		const close = value.indexOf(']]');
		if (close < 0) return { text: '', open: true };
		position = close + 2;
	}
	for (;;) {
		const start = value.indexOf('[[', position);
		if (start < 0) return { text: text + value.slice(position), open: false };
		const before = value.slice(position, start);
		text += before.endsWith('!') ? before.slice(0, -1) : before;
		const close = value.indexOf(']]', start + 2);
		if (close < 0) return { text, open: true };
		position = close + 2;
	}
}

/**
 * Whether a raw html node opens a comment it never closes. A fail-closed guard on the anti-goal boundary:
 * it covers html nodes that today's parser does not emit inside phrasing, so keep it.
 */
export function isOpenHtmlComment(node: Nodes): boolean {
	return node.type === 'html' && node.value.lastIndexOf('<!--') > node.value.lastIndexOf('-->');
}
