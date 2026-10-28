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
		for (const text of ['![Secret.png](Secret.png)', '![secret](Folder/Secret.png)', '![[Secret.png|Secret.png]]', '![[my secret.png|My_Secret]]']) {
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
});
