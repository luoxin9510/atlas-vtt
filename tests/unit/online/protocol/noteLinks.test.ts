import { describe, expect, it } from 'vitest';
import { CALLOUT_TYPES, assetImageHref, assetImageOf, calloutHead, isHttpsUrl, noteHref, noteIdOf } from '../../../../src/app/online/protocol/noteLinks.ts';

const HASH = 'ab'.repeat(32);
const ID = '0123456789abcdef01234567';

describe('note links', () => {
  it('round-trips note hrefs', () => {
    expect(noteHref(ID)).toBe(`atlas-note:${ID}`);
    expect(noteIdOf(noteHref(ID))).toBe(ID);
    expect(noteIdOf('atlas-note:short')).toBeNull();
    expect(noteIdOf(`https://x/${ID}`)).toBeNull();
  });

  it('round-trips image hrefs and refuses non-images', () => {
    const ref = { hash: HASH, size: 12, mime: 'image/png' };
    expect(assetImageHref(ref)).toBe(`atlas-asset:${HASH}?size=12&mime=image/png`);
    expect(assetImageOf(assetImageHref(ref))).toEqual(ref);
    expect(assetImageOf(`atlas-asset:${HASH}?size=1&mime=text/markdown`)).toBeNull();
    expect(assetImageOf(`atlas-asset:${HASH}?size=x&mime=image/png`)).toBeNull();
    expect(assetImageOf('atlas-asset:zz?size=1&mime=image/png')).toBeNull();
  });

  it('accepts only plain https URLs', () => {
    expect(isHttpsUrl('https://a.b/c')).toBe(true);
    for (const bad of ['http://a.b', 'javascript:alert(1)', 'HTTPS://user:pw@x', 'obsidian://open', '//x', '']) expect(isHttpsUrl(bad)).toBe(false);
  });

  it('reads callout heads', () => {
    expect(calloutHead('[!GM]- Secret')).toEqual({ type: 'gm', fold: '-', title: 'Secret' });
    expect(calloutHead('[!info]')).toEqual({ type: 'info', fold: '', title: '' });
    expect(calloutHead('[!tip]+ A  b ')).toEqual({ type: 'tip', fold: '+', title: 'A  b' });
    expect(calloutHead('[ !info]')).toBeNull();
    expect(calloutHead('[!]')).toBeNull();
    expect(calloutHead('[!info')).toBeNull();
    expect(CALLOUT_TYPES.has('warning')).toBe(true);
    expect(CALLOUT_TYPES.has('gm')).toBe(false);
  });
});
