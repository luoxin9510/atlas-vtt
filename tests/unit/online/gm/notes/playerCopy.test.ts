import { describe, expect, it } from 'vitest';
import type { AssetRef } from '../../../../../src/app/online/protocol/asset.ts';
import { assetImageHref, noteHref } from '../../../../../src/app/online/protocol/noteLinks.ts';
import { copyForPlayers, type CopyTargets } from '../../../../../src/app/online/gm/notes/playerCopy';
import { parseNote } from '../../../../../src/app/online/gm/notes/parseNote';

const SHARED_ID = 'a1b2c3d4e5f60718293a4b5c';
const SHARED = new Map([['shared', 'Shared'], ['shared.md', 'Shared']]);

const hashOf = (name: string): string => {
	let hex = '';
	for (let index = 0; index < 64; index++) hex += ((name.charCodeAt(index % name.length) + index) % 16).toString(16);
	return hex;
};
const refOf = (name: string): AssetRef => ({ hash: hashOf(name), size: 1234, mime: 'image/png' });

const targets: CopyTargets = {
	note: (linkpath) => {
		const title = SHARED.get(linkpath.toLowerCase());
		return title === undefined ? null : { id: SHARED_ID, title };
	},
	image: async (linkpath) => (linkpath.endsWith('.png') ? refOf(linkpath) : null),
};

async function copy(text: string): Promise<string> {
	return (await copyForPlayers(parseNote(text), targets)).markdown;
}

const HREF = noteHref(SHARED_ID);
/** The image source as the serialiser writes it (a bare `&` is escaped in a destination). */
const SRC = (name: string): string => assetImageHref(refOf(name)).replace('&', '\\&');

describe('what survives', () => {
	it('keeps headings, emphasis, tables and task lists', async () => {
		expect(await copy('# Title\n\nsome *em* and **strong** and ~~gone~~ and `code`\n')).toBe('# Title\n\nsome *em* and **strong** and ~~gone~~ and `code`\n');
		expect(await copy('| a | b |\n| - | - |\n| 1 | 2 |\n')).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n');
		expect(await copy('- [x] done\n- [ ] todo\n')).toBe('* [x] done\n* [ ] todo\n');
		expect(await copy('***\n\n1. one\n2. two\n')).toBe('***\n\n1. one\n2. two\n');
	});

	it('is empty for an empty or fully hidden note', async () => {
		expect(await copy('')).toBe('');
		expect(await copy('%%x%%\n')).toBe('');
	});

	it('does not touch the parsed tree', async () => {
		const tree = parseNote('---\na: b\n---\n\n[[Secret]] text %%x%% <b>h</b>\n');
		const before = JSON.stringify(tree);
		await copyForPlayers(tree, targets);
		expect(JSON.stringify(tree)).toBe(before);
	});
});

describe('links', () => {
	it('links a shared note by alias, by title and with its heading', async () => {
		expect(await copy('[[Shared|see]]')).toBe(`[see](${HREF})\n`);
		expect(await copy('[[Shared]]')).toBe(`[Shared](${HREF})\n`);
		expect(await copy('[[Shared#Fight]]')).toBe(`[Shared › Fight](${HREF})\n`);
		expect(await copy('[[Shared#^abc]]')).toBe(`[Shared](${HREF})\n`);
		expect(await copy('[x](Shared.md)')).toBe(`[x](${HREF})\n`);
		expect(await copy('[x](Shared.md#Fight)')).toBe(`[x](${HREF})\n`);
	});

	it('shows an unshared target only as its alias', async () => {
		expect(await copy('[[Secret|the vault]]')).toBe('the vault\n');
		expect(await copy('a [[Secret]] b')).toBe('a  b\n');
		expect(await copy('[x](Secret.md)')).toBe('x\n');
		expect(await copy('[x](bad%E0%A4%A.md)')).toBe('x\n');
	});

	it('keeps https links only', async () => {
		expect(await copy('[x](https://a.b)')).toBe('[x](https://a.b)\n');
		expect(await copy('[x](http://a.b)')).toBe('x\n');
		expect(await copy('[x](javascript:alert(1))')).toBe('x\n');
		expect(await copy('[x](obsidian://open?vault=v)')).toBe('x\n');
		expect(await copy('see www.a.b now')).toBe('see  now\n');
	});

	it('turns reference links into their text', async () => {
		const out = await copy('[t][r]\n\n[r]: Secret.md\n');
		expect(out).toBe('t\n');
		expect(await copy('[r]\n\n[r]: Secret.md "Hidden"\n')).toBe('r\n');
	});
});

describe('images', () => {
	it('resolves vault images, with a caption only when written', async () => {
		const result = await copyForPlayers(parseNote('![[map.png]]'), targets);
		expect(result.markdown).toBe(`![](${SRC('map.png')})\n`);
		expect([...result.images]).toEqual([[hashOf('map.png'), 'map.png']]);
		expect(await copy('![[map.png|Cave|300]]')).toBe(`![Cave](${SRC('map.png')})\n`);
		expect(await copy('![[map.png|300]]')).toBe(`![](${SRC('map.png')})\n`);
		expect(await copy('![[map.png|300x200]]')).toBe(`![](${SRC('map.png')})\n`);
		expect(await copy('![[map.png|a1|Cave]]')).toBe(`![a1](${SRC('map.png')})\n`);
		expect(await copy('![](map.png)')).toBe(`![](${SRC('map.png')})\n`);
		expect(await copy('![alt|50](my%20map.png)')).toBe(`![alt](${SRC('my map.png')})\n`);
	});

	it('drops remote and unresolved images and unshared embeds', async () => {
		expect(await copy('![x](https://cdn/x.png)')).toBe('');
		expect(await copy('![[Secret]]')).toBe('');
		expect(await copy('![[doc.pdf]]')).toBe('');
	});

	it('turns an embed of a shared note into a link', async () => {
		expect(await copy('![[Shared]]')).toBe(`[Shared](${HREF})\n`);
	});
});

describe('callouts', () => {
	it('drops gm callouts in any case, folded or nested, with their content', async () => {
		expect(await copy('> [!gm] t\n> secret\n\nafter')).toBe('after\n');
		expect(await copy('> [!GM]-\n> secret\n\nafter')).toBe('after\n');
		expect(await copy('> [!info] Open\n> shown\n>\n> > [!gm]\n> > secret\n>\n> still\n')).toBe('> [!info] Open\n>\n> shown\n>\n> still\n');
	});

	it('drops gm callouts that carry metadata or padding in the head', async () => {
		expect(await copy('> [!gm|wide] SECRET\n> more\n\nafter')).toBe('after\n');
		expect(await copy('> [!gm ] SECRET\n\nafter')).toBe('after\n');
		expect(await copy('> [!GM|wide]-\n> SECRET\n\nafter')).toBe('after\n');
		expect(await copy('- > [!gm|x] SECRET\n\nafter')).not.toContain('SECRET');
		expect(await copy('> [!info] Open\n>\n> > [!gm|x] SECRET\n\nafter')).not.toContain('SECRET');
		expect(await copy('> [!info|meta]+ Title\n> shown')).toBe('> [!info] Title\n>\n> shown\n');
	});

	it('rebuilds known callouts with a plain title and unknown ones as quotes', async () => {
		expect(await copy('> [!info]+ Title with [[Secret|alias]]\n> body')).toBe('> [!info] Title with alias\n>\n> body\n');
		expect(await copy('> [!warning]\n> careful')).toBe('> [!warning]\n>\n> careful\n');
		expect(await copy('> [!custom] T\n> body')).toBe('> T\n>\n> body\n');
		expect(await copy('> plain\n> quote')).toBe('> plain\n> quote\n');
	});
});

describe('hidden constructs', () => {
	it('drops plugin code and keeps plain code without its language', async () => {
		for (const language of ['dataview', 'dataviewjs', 'tasks', 'query', 'mermaid']) {
			expect(await copy('```' + language + '\nTABLE x\n```\n')).toBe('');
		}
		expect(await copy('```js\nlet a = 1;\n```\n')).toBe('```\nlet a = 1;\n```\n');
		expect(await copy('```\nplain\n```\n')).toBe('```\nplain\n```\n');
	});

	it('drops html, comments, math, footnotes, frontmatter and block ids', async () => {
		expect(await copy('<div>x</div>\n\n<!-- c -->\n')).toBe('');
		expect(await copy('a <b>x</b> b')).toBe('a  b\n');
		expect(await copy('a <span style="display:none">x *y* z</span> b <br> c')).toBe('a  b  c\n');
		expect(await copy('a <b>never closed *x*\n\nnext')).toBe('a\n\nnext\n');
		expect(await copy('a %%x%% b')).toBe('a  b\n');
		expect(await copy('a [^1] b\n\n[^1]: Secret note\n')).toBe('a  b\n');
		expect(await copy('$s$ and\n\n$$\nx\n$$\n')).toBe('and\n');
		expect(await copy('---\ntitle: Secret\n---\n\nbody')).toBe('body\n');
		expect(await copy('para ^abc')).toBe('para\n');
		expect(await copy('- item ^abc\n\n^def\n\n## Head ^h1')).toBe('* item\n\n## Head\n');
	});
});

describe('unclosed comments cut the copy globally', () => {
	it('ends the rest of the note', async () => {
		expect(await copy('before\n\n%%\nsecret\n\nafter')).toBe('before\n');
	});

	it('ends later list items, table cells and blocks outside the container', async () => {
		expect(await copy('- a\n- b %% c\n- d\n\nlater')).toBe('* a\n* b\n');
		expect(await copy('> q1 %% x\n\nlater')).toBe('> q1\n');
		expect(await copy('| a | b |\n| - | - |\n| 1 %% | 2 |\n| 3 | 4 |\n\nlater')).not.toMatch(/2|3|4|later/);
		expect(await copy('> [!gm]\n> %% open\n\nlater')).toBe('');
		expect(await copy('[^1]: def %% open\n\nlater')).toBe('');
	});

	it('treats a literal %% in a kept value as an unclosed comment', async () => {
		expect(await copy('keep\n\nhttps://x/%%S%% more\n\nlater')).toBe('keep\n');
		expect(await copy('keep\n\nwww.x/%%S%% more\n\nlater')).toBe('keep\n');
		expect(await copy('keep\n\n<https://x/%%S%%> more\n\nlater')).toBe('keep\n');
		expect(await copy('keep\n\nan escaped \\%%S more\n\nlater')).toBe('keep\n');
		expect(await copy('keep\n\n[txt](https://x/%%S) more\n\nlater')).toBe('keep\n');
		expect(await copy('keep\n\n[[Shared|a %% b]] more\n\nlater')).toBe('keep\n');
		expect(await copy('keep\n\n![[map.png|a \\%% b]] more\n\nlater')).toBe('keep\n');
		expect(await copy('keep\n\n> [!info] a \\%% b\n\nlater')).toBe('keep\n\n> [!info]\n');
	});
});

describe('adversarial pins: no secret word reaches the copy', () => {
	const cases: Record<string, string> = {
		'unclosed comment in a list item': '- open\n- item %% hidden\n- SECRET\n\nSECRET later',
		'unclosed comment in a table cell': '| a | b %% hidden |\n| - | - |\n| SECRET | SECRET |\n\nSECRET',
		'unclosed comment in a footnote, then visible text': '[^1]: note %% hidden\n\nSECRET visible text\n\nSECRET',
		'escaped comment mark': 'before \\%% hidden SECRET\n\nSECRET',
		'autolink holding a comment mark': 'see <https://x.y/%%> SECRET\n\nSECRET',
		'bare url holding a comment mark': 'see https://x.y/%% SECRET\n\nSECRET',
		'embeds in a table cell': '| ![[SECRET]] | ![[SECRET.png]] |\n| - | - |\n| ![[SECRET.md]] | ![SECRET](SECRET.png) |',
		'nested wikilink': '[[ [[SECRET]] ]] and [[SECRET [[SECRET]]',
	};
	it.each(Object.entries(cases))('%s', async (_name, text) => {
		expect(await copy(text)).not.toContain('SECRET');
	});
});

describe('tightening', () => {
	it('drops a non-https autolink whole but keeps the text of a written link', async () => {
		expect(await copy('a <obsidian://open?file=Secret> b')).toBe('a  b\n');
		expect(await copy('a <file:///etc/passwd> b')).toBe('a  b\n');
		expect(await copy('a <mailto:x@y.z> b')).toBe('a  b\n');
		expect(await copy('a x@y.z b')).toBe('a  b\n');
		expect(await copy('a http://a.b/Secret b')).toBe('a  b\n');
		expect(await copy('a www.a.b b')).toBe('a  b\n');
		expect(await copy('[text](obsidian://open?file=Secret)')).toBe('text\n');
		expect(await copy('<https://a.b>')).toBe('<https://a.b>\n');
	});

	it('drops an image caption that is the file name', async () => {
		for (const text of ['![Secret.png](Secret.png)', '![secret](Folder/Secret.png)', '![[Secret.png|Secret.png]]', '![[my secret.png|My_Secret]]', '![Secret%20Map.png](Secret%20Map.png)', '![Secret%20Map](Secret%20Map.png)', '![Secret Map.png](Secret%20Map.png)', '![%53ecret.png](Secret.png)', '![Sécret](Sécret.png)', '![Folder/Secret.png](Folder/Secret.png)', '![Secret%2520Map](Secret%20Map.png)', '![[Folder/Secret.png|Folder/Secret]]']) {
			expect(await copy(text), text).toMatch(/^!\[\]\(atlas-asset:/);
		}
		expect(await copy('![[Secret.png|The Secret]]')).toMatch(/^!\[The Secret\]/);
	});

	it('lists only images the output holds', async () => {
		const held = async (text: string): Promise<string[]> => [...(await copyForPlayers(parseNote(text), targets)).images.values()];
		expect(await held('![[A.png]]')).toEqual(['A.png']);
		expect(await held('> [!info] t ![[A.png]]\n> body')).toEqual([]);
		expect(await held('[![[A.png]]](https://x.y/%%)')).toEqual([]);
		expect(await held('[![[A.png]]](https://x.y/ok)')).toEqual(['A.png']);
		expect(await held('[![[A.png]]](http://x.y)')).toEqual(['A.png']);
		expect(await held('[x ![[A.png]]](Shared.md)')).toEqual(['A.png']);
	});

	it('drops a broken wikilink from text', async () => {
		expect(await copy('a [[Secret|a]b]] c')).toBe('a  c\n');
		expect(await copy('a [[Secret#h]b]] c')).toBe('a  c\n');
		expect(await copy('a [[Secret never closed')).toBe('a\n');
	});

	it('drops a broken wikilink that spans sibling nodes', async () => {
		for (const text of ['[[Secret [x](https://a.b) rest]] tail', 'a [[Secret `code` more x rest']) {
			const out = await copy(text);
			expect(out, text).not.toContain('Secret');
			expect(out, text).not.toContain('rest');
			expect(out, text).not.toContain(']]');
		}
		// a span does not cross a block: the next paragraph is kept as typed
		expect(await copy('[[Secret *em* more\n\nnext]] tail')).not.toContain('Secret');
		expect(await copy('a ![[Secret.png unclosed')).not.toContain('!');
	});

	it('refuses an image ref whose hash is not lowercase hex', async () => {
		for (const hash of ['Z'.repeat(64), 'a'.repeat(63) + ')', 'A'.repeat(64)]) {
			const result = await copyForPlayers(parseNote('![[A.png]]'), { ...targets, image: async () => ({ hash, size: 1, mime: 'image/png' }) });
			expect(result.markdown, hash).toBe('');
			expect(result.images.size, hash).toBe(0);
		}
	});

	it('cuts the copy at an unclosed inline html comment', async () => {
		const out = await copy('a <!-- unclosed SECRET\n\nSECRET2');
		expect(out).not.toContain('SECRET');
		expect(out).not.toContain('<!--');
		expect(out).toContain('a');
	});

	it('keeps an inline code span that holds <!--', async () => {
		expect(await copy('a `<!--` b')).toBe('a `<!--` b\n');
	});

	// Known over-hide: an escaped `\<!--` is only text, yet the copy cuts there. It fails closed (players see less).
	it('cuts the rest at an escaped <!--', async () => {
		expect(await copy('a \\<!-- b\n\nlater')).toBe('a\n');
	});
});

describe('more adversarial pins', () => {
	it('1: an odd number of %% opens an unclosed comment that cuts the later blocks', async () => {
		const out = await copy('a %% x %% b %% c\n\nlater');
		expect(out).toBe('a  b\n');
		expect(out).not.toContain('SECRET');
	});

	it('2: an even run of backslashes does not hide the marker', async () => {
		const out = await copy('a \\\\%% SECRET %% b');
		expect(out).toBe('a \\ b\n');
		expect(out).not.toContain('SECRET');
	});

	it('3: gm callout heads without a space and lazy lines are cut', async () => {
		const cases: [string, string][] = [
			['>[!gm] SECRET\n>more\n\nafter', 'after\n'],
			['> [!gm]\nlazy SECRET\n\nafter', 'after\n'],
			// "shown" is a lazy continuation of the inner quote, as in CommonMark and Obsidian
			['> [!info] t\n>> [!gm] SECRET\n>> more\n> shown', '> [!info] t\n'],
		];
		for (const [text, expected] of cases) {
			const out = await copy(text);
			expect(out, text).toBe(expected);
			expect(out).not.toContain('SECRET');
		}
	});

	it('4: a gm callout in a list inside a list is cut', async () => {
		const out = await copy('1. one\n   - > [!gm] SECRET\n     > more\n   - kept');
		expect(out).toBe('1. one\n   * kept\n');
		expect(out).not.toContain('SECRET');
	});

	it('5: a comment crossing a callout line break, and an unclosed one after a paragraph line, fail closed', async () => {
		const crossing = await copy('> [!info] t\n> a %%\n> SECRET\n> %% b\n\nafter');
		expect(crossing).toBe('> [!info] t\n>\n> a  b\n\nafter\n');
		expect(crossing).not.toContain('SECRET');
		// Over-hiding against Obsidian is deliberate: the unclosed inline comment cuts "visible".
		const unclosed = await copy('text\n%%\nSECRET\n\nvisible');
		expect(unclosed).toBe('text\n');
		expect(unclosed).not.toContain('SECRET');
	});

	it('6: frontmatter tricks do not leak', async () => {
		const cases: [string, string][] = [
			['\uFEFF---\nsecret: SECRET\n---\nbody', 'body\n'],
			['---   \nsecret: SECRET\n---\nbody', 'body\n'],
			['---\nsecret: %% SECRET\n---\nbody\n%%\nSECRET2', 'body\n'],
			['%%\n---\nsecret: SECRET\n---\n%%\nbody', 'body\n'],
		];
		for (const [text, expected] of cases) {
			const out = await copy(text);
			expect(out, text).toBe(expected);
			expect(out).not.toContain('SECRET');
		}
	});

	it('6: frontmatter that is not at byte 0 or not closed by --- stays visible, as in Obsidian', async () => {
		// parity with Obsidian checked 2026-10-29
		expect(await copy('\n---\nsecret: SECRET\n---\nbody')).toBe('***\n\n## secret: SECRET\n\nbody\n');
		// parity with Obsidian checked 2026-10-29
		expect(await copy('---\nsecret: SECRET\n...\nbody')).toBe('***\n\nsecret: SECRET\n...\nbody\n');
	});

	it('7: html is dropped whole', async () => {
		const cases: [string, string][] = [
			['<details><summary>x</summary>SECRET</details> after', ''],
			['<span\nhidden>SECRET</span> after', 'after\n'],
			['<script>SECRET</script>\n\nvisible', 'visible\n'],
			['<style>x{}</style>\nvisible', 'visible\n'],
			['[<b>SECRET</b>](https://a.b)', ''],
			['<!-- SECRET\n\nstill SECRET -->\nvisible', 'visible\n'],
		];
		for (const [text, expected] of cases) {
			const out = await copy(text);
			expect(out, text).toBe(expected);
			expect(out).not.toContain('SECRET');
		}
	});

	it('8: aliases to unshared notes and forged hrefs make no link and leak nothing', async () => {
		const cases: [string, string][] = [
			['[[Unshared|atlas-note:a1b2c3d4e5f60718293a4b5c]] x', 'atlas-note:a1b2c3d4e5f60718293a4b5c x\n'],
			['[[Unshared|a](https://evil.x)]] tail', '\\[[Unshared|a](https://evil.x)]] tail\n'],
			['[ref][r]\n\n[r]: Secret.md "SECRET title"', 'ref\n'],
			['# %%SECRET%%\n\nbody', 'body\n'],
		];
		for (const [text, expected] of cases) {
			const out = await copy(text);
			expect(out, text).toBe(expected);
			expect(out).not.toContain('SECRET');
		}
		// The alias is GM-written visible text, so SECRET is shown here by design; only escaping is pinned.
		expect(await copy('[[Unshared|<b>SECRET</b>]] x')).toBe('\\<b>SECRET\\</b> x\n');
		const fragment = await copy('[x](Shared.md#SECRET)');
		expect(fragment).toBe(`[x](${HREF})\n`);
		expect(fragment).not.toContain('SECRET');
		const table = await copy('| h |\n| - |\n| %%SECRET%% ok |');
		expect(table).toBe('| h  |\n| -- |\n| ok |\n');
		expect(table).not.toContain('SECRET');
	});

	it('ends the copy at an unclosed block comment inside a list or a quote', async () => {
		for (const text of ['- <!-- start\n  SECRET\n- SECRET two\n\nSECRET three', '> <!-- start\n> SECRET\n\nSECRET two']) {
			expect(await copy(`before\n\n${text}`), text).toBe('before\n');
		}
	});

	it('ends the copy at an unclosed comment after other html on its line', async () => {
		for (const text of ['<div><!-- x\n\nSECRET\n\n-->', '<!-- a --> <!-- b\n\nSECRET']) {
			expect(await copy(`before\n\n${text}`), text).toBe('before\n');
		}
	});
});
