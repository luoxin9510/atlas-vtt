import { describe, expect, it } from 'vitest';
import type { BinaryHttp } from '../../../../src/app/online/gm/assetUpload/binaryHttp.ts';
import { PART_BYTES, uploadAsset } from '../../../../src/app/online/gm/assetUpload/uploadAsset.ts';

const MIB = 1024 * 1024;
const TABLE = { origin: 'https://play.example.com', code: 'abcdefghijklmnopqrstuvwxyz'.slice(0, 26), secret: 's3cret' };
const HASH = 'a'.repeat(64);
const BASE = `${TABLE.origin}/api/tables/${TABLE.code}/assets/${HASH}`;

interface Call {
  readonly method: string;
  readonly url: string;
  readonly size: number | null;
  readonly secret: string;
}

/** A fake relay: `status` answers the GET, `fail` says how many times each part's PUT fails first, `done` is the hash `complete` answers. */
function fakeHttp(options: { status?: unknown; fail?: Record<number, number>; done?: string } = {}): { http: BinaryHttp; calls: Call[] } {
  const calls: Call[] = [];
  const failures = { ...options.fail };
  const http: BinaryHttp = (request) => {
    calls.push({ method: request.method, url: request.url, size: request.body?.byteLength ?? null, secret: request.secret });
    if (request.method === 'GET') return Promise.resolve({ status: 200, json: options.status ?? { parts: [] } });
    if (request.method === 'PUT') {
      const index = Number(request.url.split('/').pop());
      const left = failures[index] ?? 0;
      if (left > 0) {
        failures[index] = left - 1;
        return Promise.resolve({ status: 500, json: null });
      }
      return Promise.resolve({ status: 200, json: {} });
    }
    return Promise.resolve({ status: 200, json: { hash: options.done ?? HASH } });
  };
  return { http, calls };
}

const puts = (calls: readonly Call[]): string[] => calls.filter((call) => call.method === 'PUT').map((call) => `${call.url.split('/').pop()}:${(call.size ?? 0) / MIB}`);

describe('uploadAsset', () => {
  it('sends 20 MiB as parts of 8, 8 and 4 MiB, then completes', async () => {
    const { http, calls } = fakeHttp();
    expect(await uploadAsset(http, TABLE, HASH, new Uint8Array(20 * MIB))).toBe(true);
    expect(PART_BYTES).toBe(8 * MIB);
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT', 'PUT', 'POST']);
    expect(puts(calls)).toEqual(['0:8', '1:8', '2:4']);
    expect(calls[0]?.url).toBe(BASE);
    expect(calls[1]?.url).toBe(`${BASE}/parts/0`);
    expect(calls[4]?.url).toBe(`${BASE}/complete`);
    expect(calls.every((call) => call.secret === TABLE.secret)).toBe(true);
  });

  it('sends only the parts the relay lacks', async () => {
    const { http, calls } = fakeHttp({ status: { parts: [0] } });
    expect(await uploadAsset(http, TABLE, HASH, new Uint8Array(20 * MIB))).toBe(true);
    expect(puts(calls)).toEqual(['1:8', '2:4']);
  });

  it('sends nothing when the relay holds the image already', async () => {
    const { http, calls } = fakeHttp({ status: { complete: true } });
    expect(await uploadAsset(http, TABLE, HASH, new Uint8Array(MIB))).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('tries a part again after a failure', async () => {
    const { http, calls } = fakeHttp({ fail: { 1: 2 } });
    expect(await uploadAsset(http, TABLE, HASH, new Uint8Array(10 * MIB))).toBe(true);
    expect(puts(calls)).toEqual(['0:8', '1:2', '1:2', '1:2']);
  });

  it('gives up on a part that fails three times', async () => {
    const { http, calls } = fakeHttp({ fail: { 0: 3 } });
    expect(await uploadAsset(http, TABLE, HASH, new Uint8Array(MIB))).toBe(false);
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT', 'PUT']);
  });

  it('is false when the relay completes another hash, or the status cannot be read', async () => {
    expect(await uploadAsset(fakeHttp({ done: 'b'.repeat(64) }).http, TABLE, HASH, new Uint8Array(MIB))).toBe(false);
    const broken: BinaryHttp = () => Promise.resolve({ status: 401, json: null });
    expect(await uploadAsset(broken, TABLE, HASH, new Uint8Array(MIB))).toBe(false);
    const throwing: BinaryHttp = () => Promise.reject(new Error('offline'));
    expect(await uploadAsset(throwing, TABLE, HASH, new Uint8Array(MIB))).toBe(false);
  });
});
