import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type ConsoleMessage } from 'playwright';
import type WebSocket from 'ws';
import { existsSync } from 'node:fs';
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
  await browser?.close();
  browser = null;
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

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

    // The GM answers the newcomer with an unlit scene without a picture.
    const joined = await gm.frameOf('player-joined');
    await gm.send({ t: 'send', to: joined.id, body: { t: 'scene', scene: { id: 'scene-one', map: null, lit: false } } });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    expect(await page.title()).toBe('Atlas 联机桌');

    const csp = consoleMessages.filter((line) => line.includes('Content Security Policy'));
    expect(csp).toEqual([]);
    expect(pageErrors).toEqual([]);
    const header = (await page.request.get(origin)).headers()['content-security-policy'];
    expect(header).toBe("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  });
});
