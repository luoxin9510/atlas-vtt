import type { Code, State, Tokenizer } from 'micromark-util-types';
import { BANG, CLOSE_BRACKET, OPEN_BRACKET, isEnd } from './syntaxCodes';

/** `[[name]]` and `![[name]]`: one line, no brackets inside, at least one character. */
export const tokenizeWikiLink: Tokenizer = function (effects, ok, nok): State {
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
