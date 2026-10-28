import type { Code, Construct, Extension, State, TokenizeContext, Tokenizer } from 'micromark-util-types';

/**
 * micromark syntax for the three Obsidian constructs the plain Markdown grammars do not know:
 * `[[wikilink|alias]]`, `![[embed]]` and `%%comment%%`. Tokens only mark the source; the mdast
 * handlers are in `obsidianFromMarkdown.ts`. Nothing here reads the source with a regular expression.
 */

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

const BANG = 33;
const PERCENT = 37;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;

function isLineEnding(code: Code): boolean {
	return code === -5 || code === -4 || code === -3;
}

function isEnd(code: Code): boolean {
	return code === null || isLineEnding(code);
}

/** `[[name]]` and `![[name]]`: one line, no brackets inside, at least one character. */
const tokenizeWikiLink: Tokenizer = function (effects, ok, nok): State {
	let size = 0;
	return start;

	function start(code: Code): State | undefined {
		effects.enter('wikiLink');
		if (code === BANG) {
			effects.enter('wikiLinkEmbedMarker');
			effects.consume(code);
			effects.exit('wikiLinkEmbedMarker');
			effects.enter('wikiLinkMarker');
			return openFirst;
		}
		effects.enter('wikiLinkMarker');
		return openFirst(code);
	}

	function openFirst(code: Code): State | undefined {
		if (code !== OPEN_BRACKET) return nok(code);
		effects.consume(code);
		return openSecond;
	}

	function openSecond(code: Code): State | undefined {
		if (code !== OPEN_BRACKET) return nok(code);
		effects.consume(code);
		effects.exit('wikiLinkMarker');
		effects.enter('wikiLinkData');
		return content;
	}

	function content(code: Code): State | undefined {
		if (code === CLOSE_BRACKET) {
			if (size === 0) return nok(code);
			effects.exit('wikiLinkData');
			effects.enter('wikiLinkMarker');
			effects.consume(code);
			return closeSecond;
		}
		if (isEnd(code) || code === OPEN_BRACKET) return nok(code);
		size++;
		effects.consume(code);
		return content;
	}

	function closeSecond(code: Code): State | undefined {
		if (code !== CLOSE_BRACKET) return nok(code);
		effects.consume(code);
		effects.exit('wikiLinkMarker');
		effects.exit('wikiLink');
		return ok;
	}
};

/** Lookahead only: succeeds at `%%` without consuming it. */
const percentPair: Construct = {
	partial: true,
	tokenize(effects, ok, nok): State {
		return first;
		function first(code: Code): State | undefined {
			if (code !== PERCENT) return nok(code);
			effects.enter('obsidianCommentData');
			effects.consume(code);
			return second;
		}
		function second(code: Code): State | undefined {
			if (code !== PERCENT) return nok(code);
			effects.consume(code);
			effects.exit('obsidianCommentData');
			return ok;
		}
	},
};

/** The line break of a comment that goes on: fails on the end of the document and on a lazy line. */
const nonLazyBreak: Construct = {
	partial: true,
	tokenize(this: TokenizeContext, effects, ok, nok): State {
		const start: State = (code) => {
			if (!isLineEnding(code)) return nok(code);
			effects.enter('lineEnding');
			effects.consume(code);
			effects.exit('lineEnding');
			return after;
		};
		const after: State = (code) => (this.parser.lazy[this.now().line] ? nok(code) : ok(code));
		return start;
	},
};

/**
 * `%%` ... `%%` inside a paragraph. It may span the paragraph's line breaks; the end of the
 * paragraph (`null`) leaves it unclosed.
 */
const tokenizeInlineComment: Tokenizer = function (effects, ok, nok): State {
	return start;

	function start(code: Code): State | undefined {
		if (code !== PERCENT) return nok(code);
		effects.enter('obsidianComment');
		effects.enter('obsidianCommentMarker');
		effects.consume(code);
		return openSecond;
	}

	function openSecond(code: Code): State | undefined {
		if (code !== PERCENT) return nok(code);
		effects.consume(code);
		effects.exit('obsidianCommentMarker');
		return inside;
	}

	function inside(code: Code): State | undefined {
		if (code === null) {
			effects.exit('obsidianComment');
			return ok(code);
		}
		if (isLineEnding(code)) {
			effects.enter('lineEnding');
			effects.consume(code);
			effects.exit('lineEnding');
			return inside;
		}
		return effects.check(percentPair, closing, data)(code);
	}

	function closing(code: Code): State | undefined {
		effects.enter('obsidianCommentClose');
		effects.consume(code);
		return closeSecond;
	}

	function closeSecond(code: Code): State | undefined {
		effects.consume(code);
		effects.exit('obsidianCommentClose');
		effects.exit('obsidianComment');
		return ok;
	}

	function data(code: Code): State | undefined {
		effects.enter('obsidianCommentData');
		return dataChunk(code);
	}

	function dataChunk(code: Code): State | undefined {
		if (isEnd(code)) {
			effects.exit('obsidianCommentData');
			return inside(code);
		}
		if (code === PERCENT) {
			// A single `%` is data; a `%%` ends the run and is seen by `inside`.
			return effects.check(percentPair, endRun, keepRun)(code);
		}
		effects.consume(code);
		return dataChunk;
	}

	function endRun(code: Code): State | undefined {
		effects.exit('obsidianCommentData');
		return inside(code);
	}

	function keepRun(code: Code): State | undefined {
		effects.consume(code);
		return dataChunk;
	}
};

/**
 * A line starting with `%%` opens a flow comment. It runs over blank lines and blocks to the
 * line holding the next `%%` (the rest of that line is dropped), or to the end of its container
 * or document when unclosed.
 */
const tokenizeFlowComment: Tokenizer = function (this: TokenizeContext, effects, ok, nok): State {
	const start: State = (code) => {
		// A `%%` line inside a paragraph is an inline comment, not a new block.
		if (this.interrupt || code !== PERCENT) return nok(code);
		effects.enter('obsidianComment');
		effects.enter('obsidianCommentMarker');
		effects.consume(code);
		return openSecond;
	};
	return start;

	function openSecond(code: Code): State | undefined {
		if (code !== PERCENT) return nok(code);
		effects.consume(code);
		effects.exit('obsidianCommentMarker');
		return lineStart;
	}

	function lineStart(code: Code): State | undefined {
		if (isEnd(code)) return atBreak(code);
		return effects.check(percentPair, closing, data)(code);
	}

	function data(code: Code): State | undefined {
		effects.enter('obsidianCommentData');
		return dataChunk(code);
	}

	function dataChunk(code: Code): State | undefined {
		if (isEnd(code)) {
			effects.exit('obsidianCommentData');
			return atBreak(code);
		}
		if (code === PERCENT) {
			return effects.check(percentPair, endRun, keepRun)(code);
		}
		effects.consume(code);
		return dataChunk;
	}

	function endRun(code: Code): State | undefined {
		effects.exit('obsidianCommentData');
		return closing(code);
	}

	function keepRun(code: Code): State | undefined {
		effects.consume(code);
		return dataChunk;
	}

	function atBreak(code: Code): State | undefined {
		if (code === null) return finish(code);
		return effects.check(nonLazyBreak, continueLine, finish)(code);
	}

	function continueLine(code: Code): State | undefined {
		effects.enter('lineEnding');
		effects.consume(code);
		effects.exit('lineEnding');
		return lineStart;
	}

	function closing(code: Code): State | undefined {
		effects.enter('obsidianCommentClose');
		effects.consume(code);
		return closeSecond;
	}

	function closeSecond(code: Code): State | undefined {
		effects.consume(code);
		effects.exit('obsidianCommentClose');
		return rest;
	}

	/** Whatever follows the closer on its line is dropped with the comment. */
	function rest(code: Code): State | undefined {
		if (isEnd(code)) return finish(code);
		effects.enter('obsidianCommentData');
		return restChunk(code);
	}

	function restChunk(code: Code): State | undefined {
		if (isEnd(code)) {
			effects.exit('obsidianCommentData');
			return finish(code);
		}
		effects.consume(code);
		return restChunk;
	}

	function finish(code: Code): State | undefined {
		effects.exit('obsidianComment');
		return ok(code);
	}
};

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
		text: {
			[BANG]: wikiLinkConstruct,
			[OPEN_BRACKET]: wikiLinkConstruct,
			[PERCENT]: inlineCommentConstruct,
		},
		flow: { [PERCENT]: flowCommentConstruct },
	};
}
