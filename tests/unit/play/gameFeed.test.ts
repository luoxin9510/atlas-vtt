import { describe, expect, it } from 'vitest';
import type { GmMessage, PlayerMessage, YourCodeMessage } from '../../../src/app/online/protocol/index.ts';
import { messageParts } from '../../../src/app/online/gm/assetServe.ts';
import { GameFeed } from '../../../apps/play/src/net/GameFeed.ts';
import { tokenLists } from '../online/gm/shareHarness.ts';
import { sceneCorpus } from './fixtures/sceneCorpus.ts';

function feedWith(): { feed: GameFeed; applied: GmMessage[]; sent: PlayerMessage[]; codes: YourCodeMessage[]; clock: { now: number } } {
  const applied: GmMessage[] = [];
  const sent: PlayerMessage[] = [];
  const codes: YourCodeMessage[] = [];
  const clock = { now: 0 };
  const feed = new GameFeed({ send: (body) => sent.push(body), apply: (message) => applied.push(message), yourCode: (message) => codes.push(message), now: () => clock.now });
  return { feed, applied, sent, codes, clock };
}

const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body));

describe('GameFeed with the GM\'s own messages', () => {
  it('applies the corpus, ending on the token list the harness says players hold', async () => {
    const { harness, forP1 } = await sceneCorpus();
    const kinds = new Set(forP1.map(({ body }) => body.t));
    for (const kind of ['scene', 'tokens', 'mine', 'fog', 'grid', 'pins', 'annotations', 'initiative', 'delta']) expect(kinds, kind).toContain(kind);
    const { feed, applied, sent } = feedWith();
    for (const { body } of forP1) feed.receive(wire(body));
    expect(sent).toEqual([]);
    expect(applied.filter((message) => message.t === 'tokens').at(-1)).toEqual(tokenLists(harness.sent.filter(({ to }) => to === undefined)).at(-1));
    expect(applied.some((message) => message.t === 'delta')).toBe(false);
  });

  it('applies a message cut into parts once, when its last part arrives', async () => {
    const { forP1 } = await sceneCorpus();
    const scene = forP1.find(({ body }) => body.t === 'scene')?.body as GmMessage;
    const text = JSON.stringify(scene);
    // The splitter only cuts bodies over 192 KiB, so pad the scene with an ignorable field of that size.
    const big = { ...JSON.parse(text) as object, pad: 'x'.repeat(200 * 1024) };
    const parts = messageParts(big as unknown as GmMessage, () => 'one');
    expect(parts.length).toBeGreaterThan(1);
    const { feed, applied } = feedWith();
    for (const part of parts.slice(0, -1).reverse()) feed.receive(wire(part));
    expect(applied).toEqual([]);
    feed.receive(wire(parts.at(-1)));
    expect(applied.map((message) => message.t)).toEqual(['scene']);
  });

  it('ignores a part inside a part', () => {
    const inner = { t: 'part', id: 'in', index: 0, count: 1, data: btoa('{}') };
    const outer = { t: 'part', id: 'out', index: 0, count: 1, data: btoa(JSON.stringify(inner)) };
    const { feed, applied } = feedWith();
    feed.receive(outer);
    expect(applied).toEqual([]);
  });

  it('resyncs on a gap after reconnect, once per kind a second', async () => {
    const { forP1 } = await sceneCorpus();
    const delta = forP1.find(({ body }) => body.t === 'delta')?.body;
    expect(delta).toBeDefined();
    const { feed, applied, sent, clock } = feedWith();
    for (const { body } of forP1) feed.receive(wire(body));
    feed.reset();
    const before = applied.length;
    feed.receive(wire(delta));
    feed.receive(wire(delta));
    expect(applied).toHaveLength(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'resync', of: 'tokens' });
    clock.now += 999;
    feed.receive(wire(delta));
    expect(sent).toHaveLength(1);
    clock.now += 2;
    feed.receive(wire(delta));
    expect(sent).toHaveLength(2);
  });

  it('forwards your-code, and nothing else of it', () => {
    const { feed, applied, codes } = feedWith();
    feed.receive({ t: 'your-code', code: '123456', first: true });
    expect(codes).toEqual([{ t: 'your-code', code: '123456', first: true }]);
    expect(applied).toEqual([]);
  });

  it('drops what no parser reads', () => {
    const { feed, applied, sent } = feedWith();
    for (const junk of [null, 5, 'x', {}, { t: 'tokens' }, { t: 'nonsense', scene: 1 }]) feed.receive(junk);
    expect(applied).toEqual([]);
    expect(sent).toEqual([]);
  });
});
