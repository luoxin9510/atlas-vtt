import type { Nodes, Root } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseNote } from '../../../../../src/app/online/gm/notes/parseNote';

function walk(node: Nodes, visit: (node: Nodes) => void): void {
	visit(node);
	if ('children' in node) for (const child of node.children) walk(child, visit);
}

function all(tree: Root): Nodes[] {
	const found: Nodes[] = [];
	walk(tree, (node) => found.push(node));
	return found;
}

function ofType(tree: Root, type: string): Nodes[] {
	return all(tree).filter((node) => node.type === type);
}

function wikiLinks(tree: Root): Array<{ target: string; alias: string | null; embed: boolean }> {
	const links: Array<{ target: string; alias: string | null; embed: boolean }> = [];
	walk(tree, (node) => {
		if (node.type === 'wikiLink') links.push({ target: node.target, alias: node.alias, embed: node.embed });
	});
	return links;
}

function text(tree: Root): string {
	let out = '';
	walk(tree, (node) => {
		if ('value' in node && typeof node.value === 'string') out += node.value;
	});
	return out;
}

describe('parseNote: wikilinks', () => {
	it('parses target and alias', () => {
		expect(wikiLinks(parseNote('[[A|b]]'))).toEqual([{ target: 'A', alias: 'b', embed: false }]);
		expect(wikiLinks(parseNote('[[A]]'))).toEqual([{ target: 'A', alias: null, embed: false }]);
	});

	it('parses an embed and keeps the rest of the alias with its pipes', () => {
		expect(wikiLinks(parseNote('![[map.png|Cave|300]]'))).toEqual([{ target: 'map.png', alias: 'Cave|300', embed: true }]);
	});

	it('keeps the heading and block parts in the target', () => {
		expect(wikiLinks(parseNote('[[Note#Head|x]]'))[0]?.target).toBe('Note#Head');
		expect(wikiLinks(parseNote('[[Note#^abc]]'))[0]?.target).toBe('Note#^abc');
	});

	it('reads an escaped pipe in a table cell as the alias separator', () => {
		const tree = parseNote('| h |\n| - |\n| [[A\\|b]] |\n');
		expect(ofType(tree, 'table')).toHaveLength(1);
		expect(wikiLinks(tree)).toEqual([{ target: 'A', alias: 'b', embed: false }]);
	});

	it('leaves code spans and fenced code literal', () => {
		const tree = parseNote('`[[A]]` and `%%x%%`\n\n```\n[[B]]\n%%y%%\n```\n');
		expect(wikiLinks(tree)).toEqual([]);
		expect(ofType(tree, 'inlineCode')).toHaveLength(2);
		expect(ofType(tree, 'obsidianComment')).toHaveLength(0);
		expect(ofType(tree, 'code')).toHaveLength(1);
	});

	it('wins over a matching reference definition', () => {
		const tree = parseNote('[[A]]\n\n[A]: https://x.test\n');
		expect(wikiLinks(tree)).toEqual([{ target: 'A', alias: null, embed: false }]);
		expect(ofType(tree, 'linkReference')).toHaveLength(0);
	});

	it('does not take malformed links', () => {
		for (const source of ['[[]]', '[[a\nb]]', '[[a[b]]', '[[a]b]]', '[[a]']) {
			expect(wikiLinks(parseNote(source))).toEqual([]);
		}
	});
});

describe('parseNote: comments', () => {
	it('marks an inline comment and keeps nothing of it', () => {
		const tree = parseNote('a %%x%% b');
		const paragraph = tree.children[0];
		expect(paragraph?.type).toBe('paragraph');
		if (paragraph?.type !== 'paragraph') return;
		expect(paragraph.children.map((child) => child.type)).toEqual(['text', 'obsidianComment', 'text']);
		expect(paragraph.children[1]).toMatchObject({ closed: true });
		expect(JSON.stringify(tree)).not.toContain('"x"');
		expect(text(tree)).toBe('a  b');
	});

	it('spans the lines of a paragraph', () => {
		const tree = parseNote('a %%x\ny%% b');
		expect(ofType(tree, 'obsidianComment')).toHaveLength(1);
		expect(text(tree)).not.toMatch(/[xy]/u);
	});

	it('marks an inline opener without a closer as unclosed at the paragraph end', () => {
		const tree = parseNote('a %%secret\n\nnext');
		expect(ofType(tree, 'obsidianComment')).toEqual([expect.objectContaining({ closed: false })]);
		expect(text(tree)).not.toContain('secret');
	});

	it('swallows blocks inside a flow comment', () => {
		const tree = parseNote('before\n\n%%\nsecret one\n\nsecret two\n\n- item secret\n%% tail secret\n\nafter');
		expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'obsidianComment', 'paragraph']);
		expect(tree.children[1]).toMatchObject({ closed: true });
		expect(JSON.stringify(tree)).not.toContain('secret');
	});

	it('closes a one-line flow comment', () => {
		const tree = parseNote('%% hidden %%\n\nshown');
		expect(tree.children.map((child) => child.type)).toEqual(['obsidianComment', 'paragraph']);
		expect(tree.children[0]).toMatchObject({ closed: true });
	});

	it('runs an unclosed flow comment to the end of the document', () => {
		const tree = parseNote('before\n\n%%\nsecret\n\n# Heading\n\nmore');
		expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'obsidianComment']);
		expect(tree.children[1]).toMatchObject({ closed: false });
		expect(JSON.stringify(tree)).not.toContain('secret');
		expect(JSON.stringify(tree)).not.toContain('more');
	});

	it('marks a flow comment inside a list item and a block quote', () => {
		const tree = parseNote('- a\n\n  %%\n  secret\n  %%\n\n> %%\n> hidden\n> %%\n');
		expect(ofType(tree, 'obsidianComment')).toHaveLength(2);
		expect(JSON.stringify(tree)).not.toContain('secret');
		expect(JSON.stringify(tree)).not.toContain('hidden');
	});

	it('does not let a percent line interrupt a paragraph', () => {
		const tree = parseNote('line\n%% c %%\nmore');
		expect(tree.children).toHaveLength(1);
		expect(ofType(tree, 'obsidianComment')).toHaveLength(1);
	});

	it('leaves a single percent alone', () => {
		expect(text(parseNote('50% of 100%'))).toBe('50% of 100%');
		expect(ofType(parseNote('50% of 100%'), 'obsidianComment')).toHaveLength(0);
	});
});

describe('parseNote: the other syntaxes', () => {
	it('parses frontmatter', () => {
		const tree = parseNote('---\natlas-share: true\n---\n\nbody');
		expect(tree.children[0]).toMatchObject({ type: 'yaml', value: 'atlas-share: true' });
	});

	it('parses math', () => {
		const tree = parseNote('$x$\n\n$$\ny\n$$\n');
		expect(ofType(tree, 'inlineMath')).toHaveLength(1);
		expect(ofType(tree, 'math')).toHaveLength(1);
	});

	it('parses footnotes', () => {
		const tree = parseNote('a[^1]\n\n[^1]: t\n');
		expect(ofType(tree, 'footnoteReference')).toHaveLength(1);
		expect(ofType(tree, 'footnoteDefinition')).toHaveLength(1);
	});

	it('parses html', () => {
		const tree = parseNote('<b>x</b>');
		expect(ofType(tree, 'html').length).toBeGreaterThan(0);
	});
});

describe('parseNote: comment edge cases', () => {
	it('opens a flow comment after up to three spaces and with CRLF line ends', () => {
		const tree = parseNote('   %%\r\nsecret\r\n\r\nsecret2\r\n%%\r\nafter');
		expect(tree.children.map((child) => child.type)).toEqual(['obsidianComment', 'paragraph']);
		expect(JSON.stringify(tree)).not.toContain('secret');
	});

	it('ends a block-quote comment at its container and keeps the text hidden', () => {
		const tree = parseNote('> %%\n> secret\nlazy');
		expect(JSON.stringify(tree)).not.toContain('secret');
		expect(ofType(tree, 'obsidianComment')).toHaveLength(1);
	});

	it('closes on a doubled marker right after the opener', () => {
		const tree = parseNote('a %%%% b');
		expect(ofType(tree, 'obsidianComment')).toEqual([expect.objectContaining({ closed: true })]);
	});
});
