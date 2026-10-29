import type { Root } from 'mdast';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { obsidianFromMarkdown } from './obsidianFromMarkdown';
import { obsidianSyntax } from './obsidianSyntax';

/**
 * Parses an Obsidian note into an mdast tree: CommonMark, GFM, math, YAML frontmatter and
 * Obsidian's wikilinks, wiki embeds and `%%comments%%`. This is the GM side; the copy players
 * see is built from this tree by an allowlist walk, so every construct must be marked here.
 */
export function parseNote(text: string): Root {
	const tree = fromMarkdown(text, {
		extensions: [gfm(), math(), frontmatter(['yaml']), obsidianSyntax()],
		mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown(), frontmatterFromMarkdown(['yaml']), obsidianFromMarkdown()],
	});
	sources.set(tree, text);
	return tree;
}

const sources = new WeakMap<Root, string>();

/** The text a tree was parsed from (its node positions are offsets into it), or undefined for a tree built otherwise. */
export function sourceOf(tree: Root): string | undefined {
	return sources.get(tree);
}
