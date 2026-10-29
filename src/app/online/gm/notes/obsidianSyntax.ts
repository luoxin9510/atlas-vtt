import type { Construct, Extension } from 'micromark-util-types';
import { tokenizeFlowComment, tokenizeInlineComment } from './commentSyntax';
import { BANG, OPEN_BRACKET, PERCENT } from './syntaxCodes';
import { tokenizeWikiLink } from './wikiLinkSyntax';

/**
 * micromark syntax for the three Obsidian constructs the plain Markdown grammars do not know:
 * `[[wikilink|alias]]`, `![[embed]]` and `%%comment%%`. Tokens only mark the source; the mdast
 * handlers are in `obsidianFromMarkdown.ts`.
 */
const wikiLinkConstruct: Construct = { name: 'wikiLink', tokenize: tokenizeWikiLink, add: 'before' };
const inlineCommentConstruct: Construct = { name: 'obsidianComment', tokenize: tokenizeInlineComment, add: 'before' };
const flowCommentConstruct: Construct = {
	name: 'obsidianCommentFlow',
	tokenize: tokenizeFlowComment,
	concrete: true,
	add: 'before',
};

export function obsidianSyntax(): Extension {
	return {
		text: { [BANG]: wikiLinkConstruct, [OPEN_BRACKET]: wikiLinkConstruct, [PERCENT]: inlineCommentConstruct },
		flow: { [PERCENT]: flowCommentConstruct },
	};
}
