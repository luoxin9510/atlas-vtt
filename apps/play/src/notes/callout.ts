import type { BlockContent, Blockquote, DefinitionContent, PhrasingContent } from 'mdast';
import { calloutHead, CALLOUT_TYPES, type CalloutHead } from '../../../../src/app/online/protocol/noteLinks.ts';

/** A quote split into its head line and the rest, when its first paragraph starts with `[!type]`. */
export interface QuoteHead {
  readonly head: CalloutHead;
  /** Inline content of the head line after the head text (the title), as the copy wrote it. */
  readonly title: readonly PhrasingContent[];
  /** The rest of the first paragraph (after the first line), then the other blocks. */
  readonly body: readonly (BlockContent | DefinitionContent)[];
  /** Whether the type is a known one (so the quote is drawn as a callout). */
  readonly known: boolean;
}

/** Splits the first paragraph's children at the first line break: the head line and what follows. */
function splitFirstLine(children: readonly PhrasingContent[]): { line: PhrasingContent[]; rest: PhrasingContent[] } {
  const line: PhrasingContent[] = [];
  const rest: PhrasingContent[] = [];
  let broken = false;
  for (const child of children) {
    if (broken) rest.push(child);
    else if (child.type === 'break') broken = true;
    else if (child.type === 'text' && child.value.includes('\n')) {
      const at = child.value.indexOf('\n');
      line.push({ type: 'text', value: child.value.slice(0, at) });
      rest.push({ type: 'text', value: child.value.slice(at + 1) });
      broken = true;
    } else line.push(child);
  }
  return { line, rest };
}

/** The callout a blockquote is: its first child a paragraph whose first child is a text starting with a head. Null for any other quote. */
export function readQuoteHead(quote: Blockquote): QuoteHead | null {
  const first = quote.children[0];
  if (first?.type !== 'paragraph') return null;
  const { line, rest } = splitFirstLine(first.children);
  const lead = line[0];
  if (lead?.type !== 'text') return null;
  const head = calloutHead(lead.value);
  if (head === null) return null;
  const title = [{ type: 'text', value: head.title } as PhrasingContent, ...line.slice(1)].filter((node) => node.type !== 'text' || node.value !== '');
  const restBlock: (BlockContent | DefinitionContent)[] = rest.some((node) => node.type !== 'text' || node.value !== '') ? [{ type: 'paragraph', children: rest }] : [];
  return { head, title, body: [...restBlock, ...quote.children.slice(1)], known: CALLOUT_TYPES.has(head.type) };
}
