import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type ConsoleMessage } from 'playwright';
import type WebSocket from 'ws';
import { existsSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import { gmOf, type Client } from '../unit/relay/playerHarness.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY } from '../unit/relay/relayHarness.ts';

const DIST = 'apps/play/dist';
const TABLE = 'a'.repeat(26);
const running: Array<{ close(): Promise<void> }> = [];
const sockets: WebSocket[] = [];
let browser: Browser | null = null;

beforeAll(() => {
  if (!existsSync(`${DIST}/index.html`)) throw new Error('apps/play/dist is missing: run `npm run test:play-e2e`, which builds it first');
});

afterEach(async () => {
  const open = browser;
  browser = null;
  // Every step runs even if an earlier one throws.
  await Promise.allSettled([
    open?.close(),
    ...sockets.splice(0).map(async (socket) => socket.terminate()),
    ...running.splice(0).map((relay) => relay.close()),
  ]);
  removeTestState();
});

/** A solid-colour RGB PNG. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return new Uint8Array(bytes);
}

/** The relay serves the built app under its CSP at its own origin; a headless GM answers a joining player with a scene. */
async function serve(): Promise<{ origin: string; gm: Client }> {
  const probe = await startTestRelay({ port: 0 });
  const { port } = new URL(probe.origin);
  await probe.close();
  const relay = await startTestRelay({ port: Number(port), staticDir: DIST, publicOrigin: `http://127.0.0.1:${port}` });
  running.push(relay);
  const created = await fetch(`${relay.origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: relay.origin }, body: JSON.stringify({ code: TABLE }) });
  expect(created.status).toBe(201);
  const { secret } = (await created.json()) as { secret: string };
  const gm = await gmOf(relay.origin, sockets, secret);
  const gate = { t: 'gate', code: '123456', ask: false };
  await gm.send(gate);
  return { origin: relay.origin, gm };
}

describe('the player app in Chromium under the relay\'s CSP', () => {
  it('renders the Chinese join form, joins and draws the scene canvas, with no CSP violation or page error', async () => {
    const { origin, gm } = await serve();
    // Pixi needs WebGL; headless Chromium has none without a software rasteriser.
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message: ConsoleMessage) => consoleMessages.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${origin}/#${TABLE}`);
    await page.waitForSelector('form.atlas-play-join');
    expect(await page.textContent('h1')).toBe('加入此桌');
    expect(await page.title()).toBe('Atlas 联机桌');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN');

    const inputs = page.locator('form.atlas-play-join input');
    await inputs.nth(0).fill('Ana');
    await inputs.nth(1).fill('123456');
    await page.click('form.atlas-play-join button[type=submit]');

    // The GM answers the newcomer with an unlit scene: a red map, a grid, no fog and one token with blue art.
    const map = solidPng(256, 256, [220, 30, 30]);
    const art = solidPng(64, 64, [30, 30, 220]);
    const files = new Map<string, Uint8Array<ArrayBuffer>>([[await sha256Hex(map), map], [await sha256Hex(art), art]]);
    const requested: string[] = [];
    gm.socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as { t?: string; from?: string; body?: { t?: string; hash?: string } };
      if (frame.t !== 'game' || frame.body?.t !== 'asset-request' || frame.body.hash === undefined) return;
      const bytes = files.get(frame.body.hash);
      requested.push(frame.body.hash);
      if (bytes === undefined) return;
      for (const body of assetChunks(frame.body.hash, bytes)) gm.socket.send(JSON.stringify({ v: 1, t: 'send', to: frame.from, body }));
    });
    const [mapHash, artHash] = [...files.keys()] as [string, string];
    const joined = await gm.frameOf('player-joined');
    const to = joined.id;
    const say = (body: object): Promise<void> => gm.send({ t: 'send', to, body });
    await say({ t: 'scene', scene: { id: 'scene-one', map: { hash: mapHash, size: map.length, mime: 'image/png' }, lit: false } });
    await say({ t: 'grid', scene: 'scene-one', grid: { type: 'square', size: 64, offsetX: 10, offsetY: 10, colour: '#ffffff', alpha: 0.5, lineWidth: 1, lineType: 'solid', numbers: null } });
    await say({ t: 'fog', scene: 'scene-one', fog: [] });
    await say({ t: 'tokens', scene: 'scene-one', cell: 64, snap: null, tokens: [{ id: 'a'.repeat(24), x: 40, y: 40, size: 56, cells: 1, rotation: 0, art: { hash: artHash, size: art.length, mime: 'image/png' }, name: 'Hero', ring: null, claim: null, badge: null, ui: null }] });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    expect(await page.title()).toBe('Atlas 联机桌');

    // The map was asked for, downloaded, decoded and drawn: the canvas centre shows its colour (read from a screenshot in a clean page).
    await vi.waitFor(() => expect(requested).toContain(mapHash), { timeout: 30_000 });
    const centre = async (): Promise<number[]> => {
      const shot = await page.locator('canvas').first().screenshot();
      const reader = await browser!.newPage();
      const pixel = await reader.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return [...context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data];
      }, shot.toString('base64'));
      await reader.close();
      return pixel;
    };
    await vi.waitFor(async () => {
      const [r = 0, g = 0, b = 0] = await centre();
      expect(r).toBeGreaterThan(150);
      expect(g).toBeLessThan(90);
      expect(b).toBeLessThan(90);
    }, { timeout: 30_000, interval: 500 });
    await vi.waitFor(() => expect(requested).toContain(artHash), { timeout: 30_000 });

    const csp = consoleMessages.filter((line) => line.includes('Content Security Policy'));
    expect(csp).toEqual([]);
    expect(pageErrors).toEqual([]);
    const header = (await page.request.get(origin)).headers()['content-security-policy'];
    expect(header).toBe("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  });
});
