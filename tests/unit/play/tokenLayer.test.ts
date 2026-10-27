import { describe, expect, it, vi } from 'vitest';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { TokenLayer, hitOrder } from '../../../apps/play/src/scene/TokenLayer.ts';

const token = (id: string, x: number, y: number, size = 60, extra: Partial<SharedToken> = {}): SharedToken => ({
  id, x, y, size, cells: 1, rotation: 0, art: null, name: null, ring: null, claim: null, badge: null, ui: null, ...extra,
});

describe('hitOrder', () => {
  it('picks the last-listed token whose disc holds the point', () => {
    const tokens = [token('a', 100, 100), token('b', 110, 100)];
    expect(hitOrder(tokens, 105, 100)).toBe('b');
    expect(hitOrder(tokens, 75, 100)).toBe('a');
  });

  it('picks none outside every disc, also in the corner of a token box', () => {
    const tokens = [token('a', 100, 100)];
    expect(hitOrder(tokens, 200, 200)).toBeNull();
    expect(hitOrder(tokens, 128, 128)).toBeNull();
  });

  it('skips a token the caller refuses and falls to the one beneath', () => {
    const tokens = [token('a', 100, 100), token('b', 100, 100)];
    expect(hitOrder(tokens, 100, 100, (t) => t.id !== 'b')).toBe('a');
  });
});

describe('TokenLayer', () => {
  const make = (): TokenLayer => new TokenLayer({ load: vi.fn(async () => null) }, true);

  it('keeps a token container when the token moves', () => {
    const layer = make();
    layer.sync([token('a', 10, 10)], new Set(), null);
    const first = layer.containerOf('a');
    layer.sync([token('a', 50, 70)], new Set(), null);
    expect(layer.containerOf('a')).toBe(first);
    expect(first?.position.x).toBe(50);
    expect(first?.position.y).toBe(70);
    layer.destroy();
  });

  it('draws in list order and drops a token that left the list', () => {
    const layer = make();
    layer.sync([token('a', 0, 0), token('b', 0, 0), token('c', 0, 0)], new Set(), null);
    const order = (): string[] => layer.container.children.map((child) => child.label);
    expect(order()).toEqual(['a', 'b', 'c']);
    const b = layer.containerOf('b');
    layer.sync([token('c', 0, 0), token('b', 0, 0)], new Set(), null);
    expect(order()).toEqual(['c', 'b']);
    expect(layer.containerOf('b')).toBe(b);
    expect(layer.containerOf('a')).toBeUndefined();
    layer.destroy();
  });

  it('finds the token under a world point', () => {
    const layer = make();
    layer.sync([token('a', 100, 100), token('b', 300, 100)], new Set(), null);
    expect(layer.tokenAt(300, 110)).toBe('b');
    expect(layer.tokenAt(200, 100)).toBeNull();
    layer.destroy();
  });
});
