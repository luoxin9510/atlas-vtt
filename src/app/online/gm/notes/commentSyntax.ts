import type { Code, Construct, State, TokenizeContext, Tokenizer } from 'micromark-util-types';
import { commentBody } from './commentBody';
import { PERCENT, isEnd, isLineEnding } from './syntaxCodes';

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
	const body: State = commentBody(effects, { atEnd, afterClose: finish });
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
		return body;
	}

	function atEnd(code: Code): State | undefined {
		if (code === null) return finish(code);
		effects.enter('lineEnding');
		effects.consume(code);
		effects.exit('lineEnding');
		return body;
	}

	function finish(code: Code): State | undefined {
		effects.exit('obsidianComment');
		return ok(code);
	}
};

/**
 * A line starting with `%%` opens a flow comment. It runs over blank lines and blocks to the
 * line holding the next `%%` (the rest of that line is dropped), or to the end of its container
 * or document when unclosed.
 */
const tokenizeFlowComment: Tokenizer = function (this: TokenizeContext, effects, ok, nok): State {
	const body: State = commentBody(effects, { atEnd: atBreak, afterClose: rest });
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
		return body;
	}

	function atBreak(code: Code): State | undefined {
		if (code === null) return finish(code);
		return effects.check(nonLazyBreak, continueLine, finish)(code);
	}

	function continueLine(code: Code): State | undefined {
		effects.enter('lineEnding');
		effects.consume(code);
		effects.exit('lineEnding');
		return body;
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

export { tokenizeInlineComment, tokenizeFlowComment };
