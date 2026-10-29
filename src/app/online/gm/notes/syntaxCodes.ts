/**
 * Shared pieces of the Obsidian micromark syntax: the token names and the character codes.
 * Nothing in the syntax files reads the source with a regular expression.
 */
import type { Code } from 'micromark-util-types';

declare module 'micromark-util-types' {
	interface TokenTypeMap {
		wikiLink: 'wikiLink';
		wikiLinkEmbedMarker: 'wikiLinkEmbedMarker';
		wikiLinkMarker: 'wikiLinkMarker';
		wikiLinkData: 'wikiLinkData';
		obsidianComment: 'obsidianComment';
		obsidianCommentMarker: 'obsidianCommentMarker';
		obsidianCommentClose: 'obsidianCommentClose';
		obsidianCommentData: 'obsidianCommentData';
	}
}

export const BANG = 33;
export const PERCENT = 37;
export const OPEN_BRACKET = 91;
export const CLOSE_BRACKET = 93;

export function isLineEnding(code: Code): boolean {
	return code === -5 || code === -4 || code === -3;
}

export function isEnd(code: Code): boolean {
	return code === null || isLineEnding(code);
}
