import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';
import type WebSocket from 'ws';
import { existsSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { TEXT_MIME_TYPE } from '../../src/app/online/protocol/asset.ts';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import { AssetTickets } from '../../src/app/online/gm/assetUpload/AssetTickets.ts';
import type { BinaryHttp } from '../../src/app/online/gm/assetUpload/binaryHttp.ts';
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
async function serve(): Promise<{ origin: string; gm: Client; secret: string }> {
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
  return { origin: relay.origin, gm, secret };
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

  it.each([[360, 640], [1024, 768]])('lays out at %i x %i: the settings button is reachable, the token card clears the tab bar, the map stays out from under the dock', async (width, height) => {
    const { origin, gm } = await serve();
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${origin}/#${TABLE}`);
    await page.waitForSelector('form.atlas-play-join');
    const inputs = page.locator('form.atlas-play-join input');
    await inputs.nth(0).fill('Ana');
    await inputs.nth(1).fill('123456');
    await page.click('form.atlas-play-join button[type=submit]');
    const joined = await gm.frameOf('player-joined');
    const say = (body: object): Promise<void> => gm.send({ t: 'send', to: joined.id, body });
    await say({ t: 'scene', scene: { id: 'scene-one', map: null, lit: false } });
    await say({ t: 'fog', scene: 'scene-one', fog: [] });
    await page.waitForSelector('canvas', { timeout: 30_000 });

    // The settings button is what a tap at its centre reaches (nothing covers it), and its sheet opens.
    const settings = page.getByRole('button', { name: '设置' });
    const box = (await settings.boundingBox())!;
    const topmost = await page.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      return hit?.closest('button')?.getAttribute('aria-label') ?? hit?.tagName ?? null;
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(topmost).toBe('设置');
    await settings.click();
    await page.waitForSelector('.atlas-play-sheet');
    await page.locator('.atlas-play-sheet').getByRole('button', { name: '关闭' }).click();

    // The canvas host ends before the dock begins (side panel) or above the tab bar (phone).
    const dock = (await page.locator('.atlas-play-dock').boundingBox())!;
    const host = (await page.locator('.atlas-play-scene').boundingBox())!;
    if (width >= 768) expect(host.x + host.width).toBeLessThanOrEqual(dock.x + 0.5);
    else expect(host.y + host.height).toBeLessThanOrEqual(dock.y + 0.5);

    // A token card (the stylesheet decides where it goes) stands clear of the tab bar.
    const cardBottom = await page.evaluate(() => {
      const card = document.createElement('section');
      card.className = 'atlas-play-token-card';
      card.textContent = 'card';
      document.querySelector('.atlas-play-stage')!.appendChild(card);
      return card.getBoundingClientRect().bottom;
    });
    const tabs = (await page.locator('.atlas-play-tabs').boundingBox())!;
    if (width < 768) expect(cardBottom).toBeLessThanOrEqual(tabs.y + 0.5);
    else expect(await page.evaluate(() => document.querySelector('.atlas-play-token-card')!.getBoundingClientRect().right)).toBeLessThanOrEqual(dock.x + 0.5);
  });
});

const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

/** Opens the page, fills the join form and waits for the GM to see the newcomer; returns the page and the player's id. */
async function enter(origin: string, gm: Client): Promise<{ page: Page; to: string; say(body: object): Promise<void>; consoleMessages: string[]; pageErrors: string[] }> {
  browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message: ConsoleMessage) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/#${TABLE}`);
  await page.waitForSelector('form.atlas-play-join');
  const inputs = page.locator('form.atlas-play-join input');
  await inputs.nth(0).fill('Ana');
  await inputs.nth(1).fill('123456');
  await page.click('form.atlas-play-join button[type=submit]');
  const joined = await gm.frameOf('player-joined');
  const to = joined.id as string;
  return { page, to, say: (body) => gm.send({ t: 'send', to, body }), consoleMessages, pageErrors };
}

interface Box { readonly count: number; readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number; readonly width: number; readonly height: number; readonly canvasWidth: number; readonly canvasHeight: number }

/** The bounding box of the canvas pixels that `colour` names, from a screenshot read in a clean page. */
async function boxOf(page: Page, colour: 'red' | 'blue'): Promise<Box> {
  const shot = await page.locator('canvas').first().screenshot();
  const reader = await browser!.newPage();
  const box = await reader.evaluate(async ([base64, which]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let count = 0;
    let [x0, x1, y0, y1] = [image.width, -1, image.height, -1];
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const [r = 0, g = 0, b = 0] = [data[(y * image.width + x) * 4], data[(y * image.width + x) * 4 + 1], data[(y * image.width + x) * 4 + 2]];
        const hit = which === 'red' ? r > 90 && g * 2 < r && b * 2 < r : b > 120 && r < 90 && g < 90;
        if (!hit) continue;
        count += 1;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return { count, x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, canvasWidth: image.width, canvasHeight: image.height };
  }, [shot.toString('base64'), colour] as const);
  await reader.close();
  return box;
}

/** Answers asset requests with the file's chunks. */
function serveChunks(gm: Client, files: Map<string, Uint8Array<ArrayBuffer>>, requested: string[], chunkSent: string[]): void {
  gm.socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as { t?: string; from?: string; body?: { t?: string; hash?: string } };
    if (frame.t !== 'game' || frame.body?.t !== 'asset-request' || frame.body.hash === undefined) return;
    const bytes = files.get(frame.body.hash);
    requested.push(frame.body.hash);
    if (bytes === undefined) return;
    for (const body of assetChunks(frame.body.hash, bytes)) {
      chunkSent.push(frame.body.hash);
      gm.socket.send(JSON.stringify({ v: 1, t: 'send', to: frame.from, body }));
    }
  });
}

/** The GM's relay calls, as `fetch` makes them. */
const fetchHttp: BinaryHttp = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { authorization: `Bearer ${request.secret}`, ...(request.json === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(request.body === undefined ? (request.json === undefined ? {} : { body: JSON.stringify(request.json) }) : { body: request.body }),
  });
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json };
};

describe('images by ticket, lit scenes and drags in Chromium', () => {
  it('loads a ticketed map and token art under the CSP, with no chunk from the GM', async () => {
    const { origin, gm, secret } = await serve();
    const map = solidPng(256, 256, [220, 30, 30]);
    const art = solidPng(64, 64, [30, 30, 220]);
    const files = new Map<string, Uint8Array<ArrayBuffer>>([[await sha256Hex(map), map], [await sha256Hex(art), art]]);
    const [mapHash, artHash] = [...files.keys()] as [string, string];
    const tickets = new AssetTickets(fetchHttp, { origin, code: TABLE, secret }, () => Date.now());
    const asked: string[] = [];
    const chunked: string[] = [];
    gm.socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as { t?: string; from?: string; body?: { t?: string; hash?: string } };
      if (frame.t !== 'game' || frame.body?.t !== 'asset-request' || frame.body.hash === undefined || frame.from === undefined) return;
      const { hash } = frame.body;
      const bytes = files.get(hash);
      asked.push(hash);
      if (bytes === undefined) return;
      const from = frame.from;
      void tickets.ticket(hash, bytes, from).then((ticket) => {
        if (ticket === null) { chunked.push(hash); return; }
        gm.socket.send(JSON.stringify({ v: 1, t: 'send', to: from, body: ticket }));
      });
    });
    const { page, say, consoleMessages, pageErrors } = await enter(origin, gm);
    const downloads: string[] = [];
    page.on('response', (response) => { if (new URL(response.url()).pathname.startsWith('/api/assets/')) downloads.push(`${response.status()} ${response.headers()['content-type']}`); });
    await say({ t: 'scene', scene: { id: 'scene-one', map: { hash: mapHash, size: map.length, mime: 'image/png' }, lit: false } });
    await say({ t: 'fog', scene: 'scene-one', fog: [] });
    await say({ t: 'tokens', scene: 'scene-one', cell: 64, snap: null, tokens: [{ id: 'a'.repeat(24), x: 128, y: 128, size: 56, cells: 1, rotation: 0, art: { hash: artHash, size: art.length, mime: 'image/png' }, name: 'Hero', ring: null, claim: null, badge: null, ui: null }] });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await vi.waitFor(async () => expect((await boxOf(page, 'red')).count).toBeGreaterThan(1000), { timeout: 30_000, interval: 500 });
    await vi.waitFor(async () => expect((await boxOf(page, 'blue')).count).toBeGreaterThan(100), { timeout: 30_000, interval: 500 });
    expect(asked).toEqual(expect.arrayContaining([mapHash, artHash]));
    expect(chunked).toEqual([]);
    expect(downloads).toEqual(['200 image/png', '200 image/png']);
    expect(consoleMessages.filter((line) => line.includes('Content Security Policy'))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  it('shows a lit scene lit inside a walled room and dark outside, and never a frame of the unlit map', async () => {
    const { origin, gm } = await serve();
    const map = solidPng(512, 512, [220, 30, 30]);
    const files = new Map<string, Uint8Array<ArrayBuffer>>([[await sha256Hex(map), map]]);
    const requested: string[] = [];
    serveChunks(gm, files, requested, []);
    const [mapHash] = [...files.keys()] as [string];
    browser = await chromium.launch(LAUNCH);
    // Every frame the page draws is sampled right after its animation callbacks: where is any red (the unlit map's colour)?
    const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
    await context.addInitScript(() => {
      const w = window as unknown as { __cells: boolean[][]; __frames: number; requestAnimationFrame: typeof requestAnimationFrame };
      w.__cells = [];
      w.__frames = 0;
      const scratch = document.createElement('canvas');
      scratch.width = 24;
      scratch.height = 24;
      const flat = scratch.getContext('2d', { willReadFrequently: true })!;
      const sample = (): void => {
        const canvas = document.querySelector('canvas');
        if (canvas === null || canvas.width === 0) return;
        flat.clearRect(0, 0, 24, 24);
        flat.drawImage(canvas, 0, 0, 24, 24);
        const { data } = flat.getImageData(0, 0, 24, 24);
        const red: boolean[] = [];
        for (let i = 0; i < 24 * 24; i += 1) red.push(((data[i * 4] ?? 0) > 90) && (data[i * 4 + 1] ?? 0) * 2 < (data[i * 4] ?? 0) && (data[i * 4 + 2] ?? 0) * 2 < (data[i * 4] ?? 0) && (data[i * 4 + 3] ?? 0) > 200);
        w.__cells.push(red);
        w.__frames += 1;
      };
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback: FrameRequestCallback): number => original((time) => { callback(time); sample(); });
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/#${TABLE}`);
    await page.waitForSelector('form.atlas-play-join');
    const inputs = page.locator('form.atlas-play-join input');
    await inputs.nth(0).fill('Ana');
    await inputs.nth(1).fill('123456');
    await page.click('form.atlas-play-join button[type=submit]');
    const joined = await gm.frameOf('player-joined');
    const say = (body: object): Promise<void> => gm.send({ t: 'send', to: joined.id, body });

    // The room (100,100)-(300,300) with a lamp and the party's one eye in it; the rest of the map is dark.
    const room = [[100, 100, 300, 100], [300, 100, 300, 300], [300, 300, 100, 300], [100, 300, 100, 100]];
    const ref = { hash: mapHash, size: map.length, mime: 'image/png' };
    await say({ t: 'scene', scene: { id: 'scene-lit', map: ref, lit: true } });
    await say({ t: 'fog', scene: 'scene-lit', fog: [] });
    await say({ t: 'lighting', scene: 'scene-lit', cellSize: 70, unitDistance: 5, walls: room.map((p) => ({ p })), zones: [], senses: [] });
    await say({
      t: 'sight', scene: 'scene-lit', seq: 1, lighting: { enabled: true, ambient: 0 },
      lights: [{ id: 'f'.repeat(24), x: 200, y: 200, emission: { bright: 20, dim: 40, color: '#ffffff', intensity: 1, animation: 'none' } }],
      tokens: [{ id: 'e'.repeat(24), x: 150, y: 200, size: 1, vision: { senses: [] } }], held: [],
    });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    // The engine runs on swiftshader here: the room is drawn lit, and the map shows nowhere else.
    const cells = async (): Promise<boolean[][]> => page.evaluate(() => (window as unknown as { __cells: boolean[][] }).__cells);
    await vi.waitFor(async () => expect((await boxOf(page, 'red')).count).toBeGreaterThan(500), { timeout: 100_000, interval: 500 });
    const final = await boxOf(page, 'red');
    await new Promise((done) => setTimeout(done, 1_000));
    const frames = await cells();
    expect(frames.length).toBeGreaterThan(5);
    // Lit pixels inside the room only: a filled, roughly square patch much smaller than the map.
    expect(Math.abs(final.width - final.height)).toBeLessThanOrEqual(Math.max(6, final.width * 0.15));
    expect(final.width).toBeLessThan(final.canvasWidth * 0.75);
    expect(final.count / (final.width * final.height)).toBeGreaterThan(0.8);
    // No sampled frame (from the first one on) shows the map's colour outside that patch, given a cell of slack.
    const [cx0, cx1] = [Math.floor(final.x0 / final.canvasWidth * 24) - 1, Math.ceil(final.x1 / final.canvasWidth * 24) + 1];
    const [cy0, cy1] = [Math.floor(final.y0 / final.canvasHeight * 24) - 1, Math.ceil(final.y1 / final.canvasHeight * 24) + 1];
    const outside = frames.flatMap((frame) => frame.flatMap((red, index) => (red && !(index % 24 >= cx0 && index % 24 <= cx1 && Math.floor(index / 24) >= cy0 && Math.floor(index / 24) <= cy1) ? [index] : [])));
    expect(outside).toEqual([]);
    expect(frames.some((frame) => frame.some(Boolean))).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 150_000);

  it('drags an own token: drag frames at most every 100 ms, one move at the snapped cell, and the token drawn there', async () => {
    const { origin, gm } = await serve();
    const map = solidPng(256, 256, [220, 30, 30]);
    const art = solidPng(64, 64, [30, 30, 220]);
    const files = new Map<string, Uint8Array<ArrayBuffer>>([[await sha256Hex(map), map], [await sha256Hex(art), art]]);
    const [mapHash, artHash] = [...files.keys()] as [string, string];
    serveChunks(gm, files, [], []);
    const fromPlayer: Array<{ t?: string; x?: number; y?: number; at: number }> = [];
    gm.socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as { t?: string; body?: { t?: string; x?: number; y?: number } };
      if (frame.t === 'game' && (frame.body?.t === 'drag' || frame.body?.t === 'move')) fromPlayer.push({ ...frame.body, at: Date.now() });
    });
    const { page, say } = await enter(origin, gm);
    const id = 'b'.repeat(24);
    await say({ t: 'scene', scene: { id: 'scene-one', map: { hash: mapHash, size: map.length, mime: 'image/png' }, lit: false } });
    await say({ t: 'fog', scene: 'scene-one', fog: [] });
    await say({ t: 'tokens', scene: 'scene-one', cell: 64, snap: { type: 'square', size: 64, offsetX: 0, offsetY: 0 }, tokens: [{ id, x: 96, y: 96, size: 56, cells: 1, rotation: 0, art: { hash: artHash, size: art.length, mime: 'image/png' }, name: 'Hero', ring: null, claim: 'taken', badge: null, ui: null }] });
    await say({ t: 'mine', scene: 'scene-one', tokens: [id] });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await vi.waitFor(async () => expect((await boxOf(page, 'blue')).count).toBeGreaterThan(100), { timeout: 30_000, interval: 500 });
    const [mapBox, before] = [await boxOf(page, 'red'), await boxOf(page, 'blue')];
    // Screen position of a world point, from the map's own extent (256 world px).
    const scale = mapBox.width / 256;
    const canvas = (await page.locator('canvas').first().boundingBox())!;
    const screen = (wx: number, wy: number): { x: number; y: number } => ({ x: canvas.x + mapBox.x0 + wx * scale, y: canvas.y + mapBox.y0 + wy * scale });
    const start = screen(96, 96);
    const target = screen(246, 106);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(start.x + (target.x - start.x) * step / 20, start.y + (target.y - start.y) * step / 20);
      await new Promise((done) => setTimeout(done, 30));
    }
    await page.mouse.up();
    await vi.waitFor(() => expect(fromPlayer.some((frame) => frame.t === 'move')).toBe(true), { timeout: 10_000 });
    const drags = fromPlayer.filter((frame) => frame.t === 'drag');
    expect(drags.length).toBeGreaterThan(1);
    for (let i = 1; i < drags.length; i += 1) expect(drags[i]!.at - drags[i - 1]!.at).toBeGreaterThanOrEqual(80);
    // Dropped at (246, 106): the cell from 192 to 256 across and 64 to 128 down, whose centre is (224, 96).
    const moves = fromPlayer.filter((frame) => frame.t === 'move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ x: 224, y: 96 });
    // The GM has not answered: the token stays drawn at its drop for a while, at that cell's centre.
    const after = await boxOf(page, 'blue');
    const expected = screen(224, 96);
    expect(Math.abs(canvas.x + (after.x0 + after.x1) / 2 - expected.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(canvas.y + (after.y0 + after.y1) / 2 - expected.y)).toBeLessThanOrEqual(3);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(3);
  });
});

describe('shared notes in Chromium under the relay\'s CSP', () => {
  it('opens a note with a table, a callout and an image (a blob URL) and follows an in-app link, with no CSP violation', async () => {
    const { origin, gm } = await serve();
    const { page, to, say, consoleMessages, pageErrors } = await enter(origin, gm);
    const violations: string[] = [];
    await page.exposeFunction('reportViolation', (what: string) => violations.push(what));
    await page.evaluate(() => document.addEventListener('securitypolicyviolation', (event) => void (window as unknown as { reportViolation(what: string): void }).reportViolation(`${event.violatedDirective} ${event.blockedURI}`)));

    const picture = solidPng(32, 32, [30, 200, 30]);
    const pictureHash = await sha256Hex(picture);
    const imageRef = `atlas-asset:${pictureHash}?size=${picture.length}&mime=image/png`;
    const otherId = 'b'.repeat(24);
    const caveId = 'c'.repeat(24);
    const cave = [
      'The cave is damp.', '', '| Item | Count |', '| --- | --- |', '| Torch | 3 |', '', '> [!warning] Careful', '> The floor is slick.', '',
      `![A map](${imageRef.replace('&', '\\&')})`, '', `[The other note](atlas-note:${otherId})`, '',
    ].join('\n');
    const caveBytes = new TextEncoder().encode(cave);
    const otherBytes = new TextEncoder().encode('Other body text.\n');
    const files = new Map<string, Uint8Array<ArrayBuffer>>([[pictureHash, picture], [await sha256Hex(caveBytes), caveBytes], [await sha256Hex(otherBytes), otherBytes]]);
    gm.socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as { t?: string; from?: string; body?: { t?: string; hash?: string } };
      if (frame.t !== 'game' || frame.body?.t !== 'asset-request' || frame.body.hash === undefined) return;
      const bytes = files.get(frame.body.hash);
      if (bytes === undefined) return;
      for (const body of assetChunks(frame.body.hash, bytes)) gm.socket.send(JSON.stringify({ v: 1, t: 'send', to: frame.from, body }));
    });
    await say({ t: 'scene', scene: { id: 'scene-one', map: null, lit: false } });
    await say({ t: 'fog', scene: 'scene-one', fog: [] });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await say({ t: 'notes', notes: [
      { id: caveId, title: 'Cave', group: 'Places', text: { hash: await sha256Hex(caveBytes), size: caveBytes.length, mime: TEXT_MIME_TYPE } },
      { id: otherId, title: 'Other', text: { hash: await sha256Hex(otherBytes), size: otherBytes.length, mime: TEXT_MIME_TYPE } },
    ] });

    await page.getByRole('tab', { name: '笔记' }).click();
    await page.getByRole('button', { name: 'Cave' }).click();
    await page.waitForSelector('.atlas-play-notes table', { timeout: 30_000 });
    expect(await page.locator('.atlas-play-notes td').first().textContent()).toBe('Torch');
    expect(await page.locator('.atlas-play-callout-warning').count()).toBe(1);
    await vi.waitFor(async () => {
      const shown = await page.locator('.atlas-play-notes img').first().evaluate((img: HTMLImageElement) => ({ src: img.src, width: img.naturalWidth }));
      expect(shown.src.startsWith('blob:')).toBe(true);
      expect(shown.width).toBe(32);
    }, { timeout: 30_000 });

    await page.getByRole('button', { name: 'The other note' }).click();
    await page.waitForSelector('text=Other body text.', { timeout: 30_000 });
    expect(await page.locator('.atlas-play-note-title').textContent()).toBe('Other');

    expect(violations).toEqual([]);
    expect(consoleMessages.filter((line) => line.includes('Content Security Policy'))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
