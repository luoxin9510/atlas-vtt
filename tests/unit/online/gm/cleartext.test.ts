import { describe, expect, it } from 'vitest';
import { isCleartextRemote } from '../../../../src/app/online/gm/cleartext.ts';

describe('isCleartextRemote', () => {
  it('is true for http to another machine', () => {
    expect(isCleartextRemote('http://203.0.113.5:8787')).toBe(true);
    expect(isCleartextRemote('http://play.example.com')).toBe(true);
  });

  it('is false for loopback, https and text that is no address', () => {
    for (const origin of ['http://localhost:8787', 'http://127.0.0.1', 'http://127.1.2.3:80', 'http://[::1]:8787', 'https://play.example.com', 'https://203.0.113.5', '', 'nope']) {
      expect(isCleartextRemote(origin), origin).toBe(false);
    }
  });
});
