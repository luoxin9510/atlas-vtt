// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import type { SharedNote } from '../../../src/app/online/protocol/fork.ts';
import { NoteMarkdown } from '../../../apps/play/src/notes/NoteMarkdown.tsx';
import { parseCopy } from '../../../apps/play/src/notes/parseCopy.ts';

afterEach(cleanup);
initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');

const HASH = 'b'.repeat(64);
const LISTED = '1'.repeat(24);
const UNLISTED = '2'.repeat(24);
const listed: SharedNote = { id: LISTED, title: 'Listed', text: { hash: HASH, size: 3, mime: 'text/markdown' } as SharedNote['text'] };
const loaded = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', width: null, height: null };

function draw(markdown: string, onOpen: (id: string) => void = () => undefined, assets = { load: vi.fn(() => Promise.resolve(loaded)) }): HTMLElement {
  const { container } = render(<NoteMarkdown tree={parseCopy(markdown)} notes={[listed]} onOpen={onOpen} assets={assets} />);
  return container;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:note-image');
  URL.revokeObjectURL = vi.fn();
});

describe('NoteMarkdown', () => {
  it('renders only allowed elements', () => {
    const markdown = [
      '<script>alert(1)</script>', '',
      '<img src=x onerror=alert(2)>', '',
      '[a](javascript:alert(3)) [b](http://x) [c](data:text/html,hi) ![d](https://x/y.png) ![e](data:image/png;base64,AAAA) [f](atlas-note:' + UNLISTED + ') g[^1]', '',
      '[^1]: footnote text', '',
      '| h | i |', '|:-|-:|', '| 1 | 2 |', '',
      '[ok](https://example.com/x)',
    ].join('\n');
    const root = draw(markdown);
    expect(root.querySelector('script, iframe, img, style, input')).toBeNull();
    for (const element of root.querySelectorAll('*')) {
      expect(element.hasAttribute('style')).toBe(false);
      for (const name of element.getAttributeNames()) expect(name.startsWith('on')).toBe(false);
    }
    const hrefs = [...root.querySelectorAll('[href]')].map((element) => element.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/x']);
    for (const text of ['a', 'b', 'c', 'f']) expect(root.textContent).toContain(text);
    expect(root.textContent).not.toContain('alert');
    expect(root.textContent).not.toContain('footnote text');
    expect(root.innerHTML).not.toContain('javascript:');
    expect(root.querySelectorAll('th')).toHaveLength(2);
    expect(root.querySelector('th')!.className).toContain('atlas-play-align-left');
    expect(root.querySelectorAll('td')[1]!.className).toContain('atlas-play-align-right');
  });

  it('opens a link to a listed note and sets rel and target on https links', () => {
    const onOpen = vi.fn();
    const root = draw(`[go](atlas-note:${LISTED}) [web](https://example.com)`, onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(onOpen).toHaveBeenCalledWith(LISTED);
    const anchor = root.querySelector('a')!;
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows the links the re-parse invents as text, not as links', () => {
    const root = draw('www.a.b and http://q.r and mailto:x@y.z and x@y.z');
    expect(root.querySelector('a, button')).toBeNull();
    expect(root.textContent).toBe('www.a.b and http://q.r and mailto:x@y.z and x@y.z');
  });

  it('draws an asset image through the loader and revokes it on unmount', async () => {
    const assets = { load: vi.fn(() => Promise.resolve(loaded)) };
    const markdown = `![A map](atlas-asset:${HASH}?size=3&mime=image/png)`;
    const { container, unmount } = render(<NoteMarkdown tree={parseCopy(markdown)} notes={[]} onOpen={() => undefined} assets={assets} />);
    const image = await screen.findByRole('img');
    expect(image.getAttribute('alt')).toBe('A map');
    expect(image.getAttribute('src')).toBe('blob:note-image');
    expect(assets.load).toHaveBeenCalledWith({ hash: HASH, size: 3, mime: 'image/png' }, 1280);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:note-image');
  });

  it('renders a callout with its type class and title, and an unknown type as a plain quote', () => {
    const known = draw('> [!warning] Mind\n> the step');
    const callout = known.querySelector('.atlas-play-callout')!;
    expect(callout.className).toContain('atlas-play-callout-warning');
    expect(callout.textContent).toContain('Mind');
    expect(callout.textContent).toContain('the step');
    expect(callout.textContent).not.toContain('[!');
    cleanup();
    const unknown = draw('> [!madeup] Hello\n> body');
    expect(unknown.querySelector('.atlas-play-callout')).toBeNull();
    expect(unknown.querySelector('blockquote')!.textContent).toContain('Hello');
    expect(unknown.textContent).not.toContain('madeup');
  });

  it('renders lists, task items, code and rules, and drops math-like and html text', () => {
    const root = draw('1. one\n2. two\n\n- [x] done\n- [ ] open\n\n```\ncode $x$\n```\n\n---\n\n`in` ~~gone~~ **b** *i*\n\n$a$ and $$b$$');
    expect(root.querySelector('ol')).not.toBeNull();
    const boxes = [...root.querySelectorAll('input')];
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(boxes.every((box) => (box as HTMLInputElement).disabled)).toBe(true);
    expect(root.querySelector('pre > code')!.hasAttribute('class')).toBe(false);
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.querySelector('del')!.textContent).toBe('gone');
    expect(root.textContent).toContain('$a$ and $$b$$');
  });
});
