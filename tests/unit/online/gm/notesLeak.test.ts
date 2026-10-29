import type { Nodes } from 'mdast';
import { describe, expect, it } from 'vitest';
import { copyForPlayers, type CopyTargets } from '../../../../src/app/online/gm/notes/playerCopy';
import { parseNote } from '../../../../src/app/online/gm/notes/parseNote';
import { seeded } from './seeded.ts';
import { settled } from './settled.ts';
import { ANA, makeTable, type Table } from './notes/notesHarness.ts';

const TRIALS = 200;
const KEPT_KINDS: ReadonlySet<string> = new Set([
  'root', 'heading', 'paragraph', 'text', 'emphasis', 'strong', 'delete', 'inlineCode', 'code', 'list', 'listItem', 'table', 'tableRow',
  'tableCell', 'thematicBreak', 'blockquote', 'break', 'link', 'image',
]);

const hexOf = (name: string, length: number): string => {
  let hex = '';
  for (let index = 0; index < length; index++) hex += ((name.charCodeAt(index % name.length) + index) % 16).toString(16);
  return hex;
};

/** Notes named `pw…` are shared; every image in the vault resolves (its name must still never show). */
const targets: CopyTargets = {
  note: (linkpath) => (linkpath.startsWith('pw') ? { id: hexOf(linkpath, 24), title: linkpath } : null),
  image: async (linkpath) => (linkpath.endsWith('.png') ? { hash: hexOf(linkpath, 64), size: 10, mime: 'image/png' } : null),
};

interface Piece {
  readonly md: string;
  readonly secrets: string[];
  readonly publics: string[];
}

class Trial {
  readonly secrets: string[] = [];
  readonly publics: string[] = [];
  private count = 0;
  constructor(private readonly random: () => number) {}

  private letters(prefix: string): string {
    let word = prefix + (this.count++).toString(36);
    for (let index = 0; index < 8; index++) word += String.fromCharCode(97 + Math.floor(this.random() * 26));
    return word;
  }
  private readonly labels: string[] = [];
  /** A label that a definition at the end of the note defines: an undefined reference is only text. */
  private label(mark: string): string {
    const word = this.secret();
    this.labels.push(`${mark}${word}`);
    return word;
  }
  secret(): string {
    const word = this.letters('zq');
    this.secrets.push(word);
    return word;
  }
  open(): string {
    const word = this.letters('pw');
    this.publics.push(word);
    return word;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)] as T;
  }

  /** A line of inline text mixing public words with hidden inline constructs. */
  inline(): string {
    const parts: string[] = [this.open()];
    const count = 1 + Math.floor(this.random() * 3);
    for (let index = 0; index < count; index++) parts.push(this.pick(this.inlineMakers)());
    parts.push(this.open());
    return parts.join(' ');
  }

  /** Images carry their caption into a paragraph but not into a callout's plain title. */
  private readonly imageMakers: Array<() => string> = [
    () => { const name = this.secret(); return `![${name}.png](${name}.png)`; },
    () => { const name = this.secret(); return `![[${name}.png|${name}]]`; },
    () => `![[${this.secret()}.png]]`,
    () => `![[${this.secret()}.png|${this.open()}|300]]`,
    () => `![${this.secret()}](https://cdn.example/${this.secret()}.png)`,
    () => `![${this.open()}](${this.secret()}.png)`,
  ];

  private readonly textMakers: Array<() => string> = [
    () => `%%${this.secret()}%%`,
    () => `[[${this.secret()}]]`,
    () => `[[${this.secret()}|${this.open()}]]`,
    () => `[[${this.secret()}#${this.secret()}|${this.open()}]]`,
    () => `[${this.open()}](${this.secret()}.md)`,
    () => `[${this.open()}](${this.secret()}.md "${this.secret()}")`,
    () => `<span>${this.secret()}</span>`,
    () => `$${this.secret()}$`,
    () => `[^${this.label('^')}]`,
    () => `[${this.open()}][${this.label('')}]`,
    () => `<obsidian://open?file=${this.secret()}>`,
    () => `<file:///${this.secret()}>`,
    () => `<mailto:${this.secret()}@y.z>`,
    () => `www.${this.secret()}.com`,
    () => `http://${this.secret()}.org`,
    () => `[[${this.secret()}|a]b]]`,
    () => `[[${this.secret()}#h]b]]`,
    () => `[${this.open()}](obsidian://open?file=${this.secret()})`,
    () => `[[${this.open()}]]`,
    () => `[[${this.open()}#${this.open()}]]`,
    () => `*${this.open()}* **${this.open()}**`,
    () => `[${this.open()}](javascript:${this.secret()})`,
    () => `[${this.open()}](https://example.org/page)`,
  ];

  private readonly inlineMakers: Array<() => string> = [...this.textMakers, ...this.imageMakers];

  /** A flat block fragment. */
  block(): string {
    return this.pick<() => string>([
      () => this.inline(),
      () => `## ${this.open()} ${this.pick(this.inlineMakers)()}`,
      () => `${this.inline()} ^${this.secret()}`,
      () => `%%\n${this.secret()}\n\n${this.secret()}\n%%`,
      () => `<div>\n${this.secret()}\n</div>`,
      () => `<!-- ${this.secret()} -->`,
      () => '```' + this.pick(['dataview', 'dataviewjs', 'tasks', 'query', 'mermaid', 'custom-' + this.secret().slice(2, 6)]) + `\nLIST ${this.secret()}\n\`\`\``,
      () => '```js\nconst a = 1; // ' + this.open() + '\n```',
      () => `$$\n${this.secret()}\n$$`,
      () => `${this.open()} ${this.secret().length > 0 ? '' : ''}\n\n---`,
      () => `| ${this.open()} | ${this.open()} |\n| - | - |\n| ${this.open()} ${this.pick(this.inlineMakers)().replaceAll('|', '\\|')} | ${this.open()} |`,
      () => `- [x] ${this.open()}\n- [ ] ${this.inline()}`,
      () => `1. ${this.inline()}\n2. ${this.open()}`,
    ])();
  }

  /** A hidden block, in every spelling of a gm callout. */
  hidden(depth: number): string {
    const known = this.publics.length;
    const head = this.pick(['[!gm]', '[!GM]', '[!gm]-', '[!Gm]+ title', '[!gm] ' + this.secret(), '[!gm|x] ' + this.secret(), '[!gm ]', '[!GM|wide]-', '[!gm foo]+']);
    const inner = [this.secret(), depth > 0 ? this.container(depth - 1) : this.block(), this.block()].join('\n\n');
    // Words written inside a hidden block are hidden too, whatever their prefix says.
    for (const word of this.publics.splice(known)) this.secrets.push(word);
    return quote(`${head}\n${inner}`);
  }

  /** Blocks nested at random in lists, quotes and callouts. */
  container(depth: number): string {
    const blocks: string[] = [];
    const count = 1 + Math.floor(this.random() * 3);
    for (let index = 0; index < count; index++) {
      const roll = this.random();
      if (depth > 0 && roll < 0.25) blocks.push(listItem(this.container(depth - 1)));
      else if (depth > 0 && roll < 0.45) blocks.push(quote(this.container(depth - 1)));
      else if (depth > 0 && roll < 0.65) blocks.push(quote(`[!${this.pick(['info', 'warning', 'custom', 'tip'])}]${this.pick(['', '+', '-'])} ${this.open()} ${this.pick(this.textMakers)()}\n\n${this.container(depth - 1)}`));
      else if (roll < 0.8) blocks.push(this.hidden(Math.max(0, depth - 1)));
      else blocks.push(this.block());
    }
    return blocks.join('\n\n');
  }

  /** Footnote and reference definitions, which stand at the end. */
  definitions(): string {
    const own = [`[^${this.secret()}]: ${this.secret()} text`, `[${this.secret()}]: ${this.secret()}.md "${this.secret()}"`];
    const defined = this.labels.map((label) => (label.startsWith('^') ? `[${label}]: ${this.secret()} text` : `[${label}]: ${this.secret()}.md "${this.secret()}"`));
    return [...own, ...defined].join('\n\n');
  }
}

function quote(text: string): string {
  return text.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
}

function listItem(text: string): string {
  return text.split('\n').map((line, index) => (index === 0 ? `- ${line}` : line === '' ? '' : `  ${line}`)).join('\n');
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) for (const child of node.children) walk(child, visit);
}

describe('the player copy of a note never holds what the GM hides', () => {
  it.each(Array.from({ length: TRIALS }, (_, trial) => trial))('trial %i', async (trial) => {
    const gen = new Trial(seeded(9_000 + trial));
    const parts: string[] = [`---\ntitle: ${gen.secret()}\ntags: [${gen.secret()}]\n---`, `# ${gen.open()}`, gen.container(3), gen.definitions()];
    const note = parts.join('\n\n');
    if (gen.pick([true, false, false])) {
      // An unclosed comment at the end hides only what follows it.
      const tail = `${note}\n\n%% ${gen.secret()}\n\n${gen.secret()}\n\n- ${gen.secret()}`;
      await check(gen, tail);
    } else {
      await check(gen, note);
    }
  });
});

async function check(gen: Trial, note: string): Promise<void> {
  const { markdown } = await copyForPlayers(parseNote(note), targets);
  for (const word of gen.secrets) expect(markdown, `secret ${word} in:\n${note}\n=====\n${markdown}`).not.toContain(word);
  for (const word of gen.publics) expect(markdown, `public ${word} missing in:\n${note}`).toContain(word);
  walk(parseNote(markdown), (node) => expect(KEPT_KINDS.has(node.type), `${node.type} in:\n${markdown}`).toBe(true));
}

/** Every shape a `[!gm]` callout can parse as; the secret must never reach the player copy. */
const GM_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['setext dashes', '> [!gm] Twist\n> SECRET one\n> ---\n> SECRET two\n\nafter'],
  ['setext equals', '> [!gm] Twist\n> SECRET one\n> ===\n>\n> SECRET two\n\nafter'],
  ['definition head', '> [!gm]: https://x.example\n> SECRET one\n\nafter'],
  ['nested in a callout', '> [!note] Open\n> > [!gm]\n> > SECRET one\n> > ---\n> > SECRET two\n\nafter'],
  ['nested definition', '> [!note] Open\n> > [!gm]: https://x.example\n> > SECRET one\n\nafter'],
  ['in a list item', '- item\n  > [!gm]\n  > SECRET one\n  > ---\n  > SECRET two\n\nafter'],
  ['with metadata', '> [!gm|meta] Twist\n> SECRET one\n> ---\n> SECRET two\n\nafter'],
  ['BOM then setext', '\uFEFFpublic\n\n> [!gm] Twist\n> SECRET one\n> ---\n> SECRET two\n\nafter'],
  ['BOM then definition at the start', '\uFEFF> [!gm]: https://x.example\n> SECRET one\n\nafter'],
  ['BOM, frontmatter, setext', '\uFEFF---\ntitle: t\n---\n> [!gm] Twist\n> SECRET one\n> ===\n> SECRET two\n\nafter'],
  ['folded and upper case', '> [!GM]- Twist\n> SECRET one\n> ===\n> SECRET two\n\nafter'],
];

describe('a gm callout is dropped whatever its first line parses as', () => {
  it.each(GM_SHAPES)('%s', async (_name, note) => {
    const { markdown } = await copyForPlayers(parseNote(note), targets);
    expect(markdown).not.toContain('SECRET');
    expect(markdown).not.toContain('Twist');
    expect(markdown).toContain('after');
  });
});

const SHARE_TRIALS = 30;
const SHARE_STEPS = 14;
const NOTE_COUNT = 4;

interface Slot {
  name: string;
  flagged: boolean;
  exists: boolean;
}

/** The text a chunk message carries, decoded. */
const chunkText = (body: { readonly data: string }): string => Buffer.from(body.data, 'base64').toString('utf8');

describe('the shared notes never send what the GM hides', () => {
  it.each(Array.from({ length: SHARE_TRIALS }, (_, trial) => trial))('trial %i', async (trial) => {
    const random = seeded(31_000 + trial);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
    const slots: Slot[] = Array.from({ length: NOTE_COUNT }, (_, index) => ({ name: `nm${index}x0`, flagged: false, exists: false }));
    const forbidden = new Set<string>();
    const sharedNames = new Set<string>();
    const unsharedNames = new Set<string>();
    let renames = 0;
    const table: Table = makeTable({});
    const hashes = new Set<string>();
    let output = '';
    /** What a version of a note says: shared or not, with words it must show and words it must not. */
    const write = (slot: Slot): void => {
      const gen = new Trial(random);
      const others = slots.filter((other) => other !== slot && other.exists);
      const links = others.map((other) => `[[${other.name}]] [[${other.name}|${gen.open()}]]`).join(' ');
      const group = slot.flagged ? `atlas-share-group: grp${renames++}g\n` : '';
      const front = `---\natlas-share: ${slot.flagged}\n${group}title: ${gen.secret()}\n---`;
      table.vault.write(`${slot.name}.md`, [front, `# ${gen.open()}`, links, gen.container(2), gen.definitions()].join('\n\n'));
      for (const word of gen.secrets) forbidden.add(word);
      if (!slot.flagged) for (const word of gen.publics) forbidden.add(word);
      (slot.flagged ? sharedNames : unsharedNames).add(slot.name);
      if (slot.flagged) sharedNames.add(`grp${renames - 1}g`);
    };
    const collect = async (): Promise<void> => {
      for (const note of table.list()) hashes.add(note.text.hash);
      table.sent.length = 0;
      for (const hash of hashes) {
        table.share.playerLeft(ANA);
        table.share.receive(ANA, { t: 'asset-request', hash });
      }
      await settled();
      output += JSON.stringify(table.sent.map((entry) => entry.body)) + table.sent.flatMap((entry) => (entry.body.t === 'asset-chunk' ? [chunkText(entry.body)] : [])).join('\n');
    };
    table.share.start();
    for (let step = 0; step < SHARE_STEPS; step++) {
      const batch = 1 + Math.floor(random() * 3);
      for (let index = 0; index < batch; index++) {
        const slot = pick(slots);
        const op = pick(['share', 'unshare', 'edit', 'rename', 'delete'] as const);
        if (op === 'delete' && slot.exists) {
          table.vault.remove(`${slot.name}.md`);
          slot.exists = false;
          slot.flagged = false;
        } else if (op === 'rename' && slot.exists) {
          const name = `nm${slots.indexOf(slot)}x${++renames}`;
          await table.vault.move(`${slot.name}.md`, `${name}.md`);
          slot.name = name;
          write(slot);
        } else {
          slot.exists = true;
          if (op === 'share') slot.flagged = true;
          else if (op === 'unshare') slot.flagged = false;
          write(slot);
        }
      }
      await settled();
      await collect();
    }
    await settled();
    await collect();
    for (const name of unsharedNames) if (!sharedNames.has(name)) forbidden.add(name);
    for (const word of forbidden) expect(output, `${word} reached players`).not.toContain(word);
    // The list is exactly the notes flagged now, and no listed text names a note that is not.
    expect(table.list().map((note) => note.title).sort()).toEqual(slots.filter((slot) => slot.exists && slot.flagged).map((slot) => slot.name).sort());
    table.share.stop();
  });
});
