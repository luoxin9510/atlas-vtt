import type { Nodes } from 'mdast';
import { describe, expect, it } from 'vitest';
import { copyForPlayers, type CopyTargets } from '../../../../src/app/online/gm/notes/playerCopy';
import { parseNote } from '../../../../src/app/online/gm/notes/parseNote';
import { seeded } from './seeded.ts';

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
    const head = this.pick(['[!gm]', '[!GM]', '[!gm]-', '[!Gm]+ title', '[!gm] ' + this.secret()]);
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
