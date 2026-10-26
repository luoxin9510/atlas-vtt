import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_SERVER_TEXT, startBlock, NO_ACCOUNT } from '../../../../src/app/online/gm/tableStart.ts';
import { setServerOrigin } from '../../../../src/app/online/gm/servers.ts';

vi.mock('obsidian', () => ({ Notice: class {}, normalizePath: (path: string) => path, requestUrl: () => Promise.resolve({ status: 201, json: null }), PluginSettingTab: class {}, Setting: class {} }));

describe('starting a table with no server address set', () => {
  afterEach(() => setServerOrigin(null));

  it('is refused before anything else is asked', () => {
    setServerOrigin(null);
    expect(startBlock(null, null, NO_ACCOUNT)).toBe(NO_SERVER_TEXT);
    expect(NO_SERVER_TEXT).toBe('Set the online server address in Atlas settings first.');
  });

  it('is refused for the tab instead once an address is set', () => {
    setServerOrigin('https://play.example.com');
    expect(startBlock(null, null, NO_ACCOUNT)).toBe('Open an Atlas map tab first.');
  });
});
