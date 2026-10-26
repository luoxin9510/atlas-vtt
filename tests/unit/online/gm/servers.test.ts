import { afterEach, describe, expect, it } from 'vitest';
import { isSelfHosted, normalizeServerOrigin, relayOrigin, setServerOrigin, UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';

describe('normalizeServerOrigin', () => {
  it('lowercases scheme and host and drops a trailing slash', () => {
    expect(normalizeServerOrigin('https://Play.Example.com/')).toBe('https://play.example.com');
    expect(normalizeServerOrigin('HTTP://Play.Example.com')).toBe('http://play.example.com');
  });

  it('drops a default port and keeps another', () => {
    expect(normalizeServerOrigin('https://play.example.com:443')).toBe('https://play.example.com');
    expect(normalizeServerOrigin('http://play.example.com:80/')).toBe('http://play.example.com');
    expect(normalizeServerOrigin('http://192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
  });

  it('rejects paths, queries, fragments, credentials, other schemes and non-addresses', () => {
    for (const bad of ['https://x.com/path', 'https://x.com/?a=1', 'https://x.com?', 'https://x.com#', 'ws://x.com', 'https://u:p@x.com', 'https://u@x.com', '', 'play.example.com', 'https://']) {
      expect(normalizeServerOrigin(bad), bad).toBeNull();
    }
  });
});

describe('the server origin', () => {
  afterEach(() => setServerOrigin(null));

  it('is none until set', () => {
    setServerOrigin(null);
    expect(relayOrigin()).toBeNull();
    expect(isSelfHosted()).toBe(false);
  });

  it('is self-hosted where it differs from Atlas\'s own', () => {
    setServerOrigin('https://play.example.com');
    expect(relayOrigin()).toBe('https://play.example.com');
    expect(isSelfHosted()).toBe(true);
    setServerOrigin(UPSTREAM_RELAY_ORIGIN);
    expect(isSelfHosted()).toBe(false);
  });
});
