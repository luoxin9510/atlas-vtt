import type { Root } from 'mdast';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';

/**
 * The tree of a note's copy. GFM only, never math or another extension: the GM's copy leaves `$` unescaped, so math would turn plain text into math nodes.
 * GFM's autolinks do turn some plain text into links (`www.a.b`, `http://q.r`, `x@y.z`); the renderer's link allowlist shows those as text.
 */
export function parseCopy(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}
