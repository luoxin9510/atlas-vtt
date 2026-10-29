// Checks a deployed relay from the outside.
//   HOST_KEY=... node scripts/relay-probe.mjs <origin> [--quick] [--insecure]
// The host key comes from the environment only. Nothing secret (host key, table secret, tickets, player link) is printed.
// --quick skips the 110 s idle check. A non-loopback http: origin sends the host key in clear text and is refused unless --insecure is given.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const origin = args.find((arg) => !arg.startsWith('--'))?.replace(/\/$/, '');
const hostKey = process.env.HOST_KEY;
if (origin === undefined || hostKey === undefined || hostKey === '') {
  console.error('usage: HOST_KEY=<key> node scripts/relay-probe.mjs <origin> [--quick] [--insecure]');
  process.exit(2);
}
/** Same rule as the GM side (src/app/online/gm/cleartext.ts): localhost, 127.0.0.0/8, [::1]. */
function loopbackHost(host) {
  return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}
let parsed = null;
try { parsed = new URL(origin); } catch { /* reported below */ }
if (parsed === null) {
  console.error('the origin is not a URL');
  process.exit(2);
}
if (parsed.protocol === 'http:' && !loopbackHost(parsed.hostname) && !args.includes('--insecure')) {
  console.error('refusing to send the host key over cleartext http: to a non-local origin; use https:, or pass --insecure to accept the risk');
  process.exit(2);
}

const FRAME = 320 * 1024;
const PART = 8 * 1024 * 1024;
const IDLE_MS = 110_000;
const ENDED = 4008; // CLOSE.ended in src/app/online/protocol/relay.ts
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const code = Array.from(randomBytes(26), (byte) => BASE32[byte % 32]).join('');
const results = [];
let secret = null;
let gm = null;
let player = null;

function report(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` (${detail})`}`);
  return ok;
}

class Peer {
  constructor(role) {
    this.frames = [];
    this.waiters = [];
    this.closeCode = null;
    this.socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/api/tables/${code}/socket`, { origin, maxPayload: 1024 * 1024 });
    this.socket.on('message', (data) => {
      const text = data.toString();
      if (text === 'pong') return;
      this.frames.push(JSON.parse(text));
      this.waiters.splice(0).forEach((wake) => wake());
    });
    this.socket.on('close', (closeCode) => {
      this.closeCode = closeCode;
      this.waiters.splice(0).forEach((wake) => wake());
    });
    this.socket.on('error', () => undefined);
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
      this.socket.once('close', () => reject(new Error(`closed before open (${this.closeCode})`)));
    });
    this.role = role;
  }

  async send(frame) {
    await this.opened;
    this.socket.send(JSON.stringify({ v: 1, ...frame }));
  }

  async waitFor(test, ms = 15_000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.frames.find(test);
      if (found !== undefined) return found;
      if (this.closeCode !== null) throw new Error(`socket closed ${this.closeCode}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('timed out');
      await new Promise((wake) => {
        this.waiters.push(wake);
        setTimeout(wake, left).unref();
      });
    }
  }

  get open() {
    return this.socket.readyState === WebSocket.OPEN;
  }
}

async function check(name, run) {
  try {
    const detail = await run();
    return report(name, true, typeof detail === 'string' ? detail : '');
  } catch (error) {
    return report(name, false, error instanceof Error ? error.message : 'error');
  }
}

async function createTable() {
  const response = await fetch(`${origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${hostKey}`, origin }, body: JSON.stringify({ code }) });
  if (response.status !== 201) throw new Error(`status ${response.status}`);
  secret = (await response.json()).secret;
}

async function joinPlayer() {
  gm = new Peer('gm');
  await gm.send({ t: 'hello', role: 'gm', secret, level: 7 });
  await gm.waitFor((frame) => frame.t === 'welcome' && frame.role === 'gm');
  await gm.send({ t: 'gate', code: null, ask: false });
  player = new Peer('player');
  await player.send({ t: 'hello', role: 'player', name: 'Probe' });
  const welcome = await player.waitFor((frame) => frame.t === 'welcome' && frame.role === 'player');
  await gm.waitFor((frame) => frame.t === 'player-joined' && frame.id === welcome.id);
  player.id = welcome.id;
}

async function bigFrame() {
  const envelope = JSON.stringify({ v: 1, t: 'send', to: player.id, body: '' }).length;
  const body = 'p'.repeat(FRAME - envelope);
  await gm.send({ t: 'send', to: player.id, body });
  const frame = await player.waitFor((candidate) => candidate.t === 'game');
  if (frame.body !== body) throw new Error('frame arrived changed');
  return `${FRAME} bytes`;
}

async function idle() {
  await new Promise((done) => setTimeout(done, IDLE_MS));
  if (!gm.open || !player.open) throw new Error('a socket closed while idle');
  gm.socket.send('ping');
  await gm.send({ t: 'send', to: player.id, body: 'after-idle' });
  await player.waitFor((frame) => frame.t === 'game' && frame.body === 'after-idle');
  return `${IDLE_MS / 1000} s`;
}

async function upload() {
  const part = Buffer.alloc(PART, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(part);
  const hash = createHash('sha256').update(part).digest('hex');
  const url = `${origin}/api/tables/${code}/assets/${hash}`;
  const headers = { authorization: `Bearer ${secret}` };
  const put = await fetch(`${url}/parts/0`, { method: 'PUT', headers, body: part });
  if (put.status !== 200) throw new Error(`part status ${put.status}`);
  const done = await fetch(`${url}/complete`, { method: 'POST', headers });
  if (done.status !== 200) throw new Error(`complete status ${done.status}`);
  return '8 MiB';
}

async function end() {
  await gm.send({ t: 'end' });
  const deadline = Date.now() + 10_000;
  while (player.closeCode === null && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 100));
  if (player.closeCode !== ENDED) throw new Error(`player close code ${player.closeCode}`);
  return `player closed ${ENDED}`;
}

console.log(`probe ${origin}${quick ? ' (quick: no idle check)' : ''}`);
const created = await check('create table', createTable);
if (created) {
  const joined = await check('gm and player join (player sends Origin)', joinPlayer);
  if (joined) {
    await check('320 KiB gm frame arrives whole', bigFrame);
    if (quick) console.log('SKIP sockets stay open after 110 s idle (--quick)');
    else await check('sockets stay open after 110 s idle', idle);
    await check('8 MiB part upload and complete', upload);
    await check('end table', end);
  }
}
for (const peer of [gm, player]) peer?.socket.terminate();
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `all ${results.length} checks passed` : `${failed} of ${results.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
