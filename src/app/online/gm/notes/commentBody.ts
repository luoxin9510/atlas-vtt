import type { Code, Construct, Effects, State } from 'micromark-util-types';
import { PERCENT, isEnd } from './syntaxCodes';

/** Lookahead only: succeeds at `%%` without consuming it. */
export const percentPair: Construct = {
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

/** What the inline and the flow comment do differently once the opening `%%` is consumed. */
export interface CommentBodyHooks {
	/** The end of a line or of the document, inside the comment. */
	atEnd: State;
	/** The code after the closing `%%`. */
	afterClose: State;
}

/**
 * The text of a comment from just after its opening `%%` to just after its closing `%%`: data runs
 * (a single `%` is data), the closer, and the caller's choice at a line end and after the closer.
 * Returns the state to continue from.
 */
export function commentBody(effects: Effects, hooks: CommentBodyHooks): State {
	function lineStart(code: Code): State | undefined {
		if (isEnd(code)) return hooks.atEnd(code);
		return effects.check(percentPair, closing, data)(code);
	}

	function data(code: Code): State | undefined {
		effects.enter('obsidianCommentData');
		return dataChunk(code);
	}

	function dataChunk(code: Code): State | undefined {
		if (isEnd(code)) {
			effects.exit('obsidianCommentData');
			return hooks.atEnd(code);
		}
		if (code === PERCENT) {
			// A single `%` is data; a `%%` ends the run.
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

	function closing(code: Code): State | undefined {
		effects.enter('obsidianCommentClose');
		effects.consume(code);
		return closeSecond;
	}

	function closeSecond(code: Code): State | undefined {
		effects.consume(code);
		effects.exit('obsidianCommentClose');
		return hooks.afterClose;
	}

	return lineStart;
}
