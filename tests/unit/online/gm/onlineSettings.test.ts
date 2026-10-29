// @vitest-environment jsdom
import { Setting } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { AccountControl } from '../../../../src/app/online/gm/account/AccountControl.ts';
import type { HttpRequest, HttpResponse } from '../../../../src/app/online/gm/account/http.ts';
import { relayOrigin, setServerOrigin, UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';
import { DEFAULT_SETTINGS, onlineSettingsSections, readSettings, type OnlineSettings } from '../../../../src/app/online/gm/settings.ts';
import { useUpstreamServer } from './upstreamServer.ts';

useUpstreamServer();

const MARA = { id: 'acc_mara', handle: 'mara', name: 'Mara' };

describe('online play\'s settings data', () => {
  it('reports no errors until the GM switches it on', () => {
    expect(DEFAULT_SETTINGS).toEqual({ reportErrors: false, serverOrigin: '' });
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ reportErrors: 'yes' })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ reportErrors: true })).toEqual({ ...DEFAULT_SETTINGS, reportErrors: true });
  });

  it('keeps nothing of a key that made tables without an account', () => {
    const read = readSettings({ createKey: 'owner-key', reportErrors: false });
    expect(read).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(read).sort()).toEqual(['reportErrors', 'serverOrigin']);
  });
});

describe('online play\'s settings', () => {
  /** Online play's settings with a GM signed in. */
  function host(me: HttpResponse): { settings: OnlineSettings; account: AccountControl; saveSettings: () => Promise<void>; sectionsChanged: () => void; sectionsChangedCalls: number; opened: string[]; saved: OnlineSettings[]; requests: HttpRequest[]; keyIs(): string | null } {
    const settings = { ...DEFAULT_SETTINGS };
    const opened: string[] = [];
    const saved: OnlineSettings[] = [];
    const requests: HttpRequest[] = [];
    let sectionsChangedCalls = 0;
    let token: string | null = 'tok';
    let key: string | null = null;
    const account = new AccountControl({
      http: (request) => (requests.push(request), Promise.resolve(me)),
      timers: { now: () => 0, setTimer: () => 0, clearTimer: () => undefined },
      tokens: { get: () => token, set: (next) => (token = next), clear: () => (token = null) },
      hostKeys: { get: () => key, set: (next) => (key = next), clear: () => (key = null) },
      openUrl: (url) => void opened.push(url),
      notify: () => undefined,
    });
    return { settings, account, sectionsChanged: () => void (sectionsChangedCalls += 1), get sectionsChangedCalls() { return sectionsChangedCalls; }, opened, saved, requests, keyIs: () => key, saveSettings: () => Promise.resolve(void saved.push({ ...settings })) };
  }

  /** The sections drawn as the settings tab draws them. */
  function draw(of: ReturnType<typeof host>): { headings: string[]; names: string[]; row(name: string): Setting } {
    const sections = onlineSettingsSections(of);
    const rows = new Map<string, Setting>();
    for (const section of sections) {
      for (const row of section.rows) {
        const setting = new Setting(document.body.createDiv()).setName(row.name);
        if (row.desc !== undefined) setting.setDesc(row.desc);
        row.render(setting);
        rows.set(row.name, setting);
      }
    }
    return {
      headings: sections.map((section) => section.heading),
      names: [...rows.keys()],
      row: (name) => {
        const row = rows.get(name);
        if (row === undefined) throw new Error(`no row ${name}`);
        return row;
      },
    };
  }

  const buttonsOf = (setting: Setting): string[] => [...setting.controlEl.querySelectorAll('button')].map((button) => button.textContent ?? '');

  it('explain how notes are shared, with the literal tokens', () => {
    const drawn = draw(host({ status: 200, json: { account: MARA, access: null, reason: 'no-access' } }));
    expect(drawn.headings).toContain('Shared notes');
    const desc = drawn.row('How notes are shared').descEl.textContent;
    expect(desc).toBe('A note is shared with players when its frontmatter has `atlas-share: true`; `atlas-share-group` sets the group players see. Players never see `[!gm]` callouts, `%%comments%%`, links to notes that are not shared, or file names. Headings and other conventions hide nothing.');
  });

  it('have the account and error reports, and neither a key that creates tables nor the relay\'s account data', () => {
    const drawn = draw(host({ status: 200, json: { account: MARA, access: null, reason: 'no-access' } }));
    expect(drawn.headings).toEqual(['Online server', 'Shared notes', 'Online diagnostics']);
    expect(drawn.names).toEqual(['Online server address', 'Host key', 'Atlas account', 'How notes are shared', 'Send error reports']);
  });

  it('say in the account row why the account may not host, with the way to the account page', async () => {
    const of = host({ status: 200, json: { account: MARA, access: null, reason: 'access-revoked' } });
    const row = draw(of).row('Atlas account');
    expect(row.descEl.textContent).toBe('Checking your account…');
    await of.account.refresh(true);
    expect(row.descEl.textContent).toBe('Signed in as Mara (@mara). Your access to online play was withdrawn. See your account page.');
    expect(buttonsOf(row)).toEqual(['Sign out', 'Open account page']);
    row.controlEl.querySelectorAll('button')[1]?.click();
    expect(of.opened).toEqual(['https://atlas-vtt.dev/account']);
    expect(row.controlEl.querySelector('input')).toBeNull();
  });

  it('say what an account that may host holds, asked of Atlas\'s table server', async () => {
    const of = host({ status: 200, json: { account: MARA, access: { plan: 'beta', maxPlayers: 12, endsAt: null } } });
    const row = draw(of).row('Atlas account');
    await of.account.refresh(true);
    expect(row.descEl.textContent).toBe('Signed in as Mara (@mara) · Early access · up to 12 players');
    expect(buttonsOf(row)).toEqual(['Sign out', 'Open account page']);
    expect(of.requests.map((request) => request.url)).toEqual(['https://play.atlas-vtt.dev/api/me']);
  });

  const typed = (setting: Setting, text: string): void => {
    const input = setting.controlEl.querySelector('input');
    if (input === null) throw new Error('no input');
    input.value = text;
    input.dispatchEvent(new Event('change'));
  };

  it('take the server address normalised, apply it at once, and answer an invalid one with how to write it', async () => {
    const of = host({ status: 200, json: {} });
    const drawn = draw(of);
    const row = drawn.row('Online server address');
    expect(row.controlEl.querySelector('input')?.value).toBe('');
    typed(row, ' https://Tables.Example.com/ ');
    await Promise.resolve();
    expect(of.settings.serverOrigin).toBe('https://tables.example.com');
    expect(relayOrigin()).toBe('https://tables.example.com');
    expect(row.controlEl.querySelector('input')?.value).toBe('https://tables.example.com');
    expect(of.saved.at(-1)?.serverOrigin).toBe('https://tables.example.com');
    // The row set is fixed, so the settings page is not drawn again (a redraw would drop the field's focus).
    expect(of.sectionsChangedCalls).toBe(0);

    typed(row, 'nope');
    expect(row.descEl.textContent).toBe('Enter an address such as https://play.example.com.');
    // An invalid address changes nothing.
    expect(relayOrigin()).toBe('https://tables.example.com');
    expect(of.settings.serverOrigin).toBe('https://tables.example.com');

    typed(row, '');
    expect(of.settings.serverOrigin).toBe('');
    expect(relayOrigin()).toBeNull();
    expect(row.descEl.textContent).not.toBe('Enter an address such as https://play.example.com.');
  });

  it('keep the host key in the secret store only while self-hosted, and never show it back', () => {
    const of = host({ status: 200, json: {} });
    const key = draw(of).row('Host key');
    expect(key.controlEl.querySelector('input')).toBeNull();
    setServerOrigin('https://tables.example.com');
    const drawn = draw(of);
    const input = drawn.row('Host key').controlEl.querySelector('input');
    expect(input?.type).toBe('password');
    typed(drawn.row('Host key'), ' secret-host-key ');
    expect(of.keyIs()).toBe('secret-host-key');
    expect(drawn.row('Host key').controlEl.querySelector('input')?.value).toBe('');
    expect(JSON.stringify(of.saved)).not.toContain('secret-host-key');
    expect(of.requests).toEqual([]);
  });

  it('keep the host key when its field is emptied by hand: the Remove button clears it', () => {
    setServerOrigin('https://tables.example.com');
    const of = host({ status: 200, json: {} });
    typed(draw(of).row('Host key'), 'secret-host-key');
    expect(of.keyIs()).toBe('secret-host-key');
    typed(draw(of).row('Host key'), '');
    typed(draw(of).row('Host key'), '   ');
    expect(of.keyIs()).toBe('secret-host-key');
    const remove = draw(of).row('Host key').controlEl.querySelector('button');
    remove?.click();
    expect(of.keyIs()).toBeNull();
  });

  const removeOf = (setting: Setting): HTMLButtonElement | null => setting.controlEl.querySelector('button');
  const placeholderOf = (setting: Setting): string | undefined => setting.controlEl.querySelector('input')?.placeholder;

  it('show the Remove button only while a key is set, and paste again once it is removed', () => {
    setServerOrigin('https://tables.example.com');
    const of = host({ status: 200, json: {} });
    const row = draw(of).row('Host key');
    expect(removeOf(row)).toBeNull();
    const pasteHere = placeholderOf(row);
    typed(row, 'secret-host-key');
    // The same row draws itself again in place; the tab is not asked for its sections again.
    expect(buttonsOf(row)).toEqual(['Remove']);
    expect(placeholderOf(row)).not.toBe(pasteHere);
    expect(of.sectionsChangedCalls).toBe(0);
    removeOf(row)?.click();
    expect(of.keyIs()).toBeNull();
    expect(removeOf(row)).toBeNull();
    expect(placeholderOf(row)).toBe(pasteHere);
  });

  it('hide the Host key row, Remove button with it, when the address goes back to Atlas\'s own server', () => {
    setServerOrigin('https://tables.example.com');
    const of = host({ status: 200, json: {} });
    const drawn = draw(of);
    typed(drawn.row('Host key'), 'secret-host-key');
    expect(buttonsOf(drawn.row('Host key'))).toEqual(['Remove']);
    typed(drawn.row('Online server address'), UPSTREAM_RELAY_ORIGIN);
    expect(drawn.row('Host key').settingEl.style.display).toBe('none');
    expect(removeOf(drawn.row('Host key'))).toBeNull();
  });

  it('warn under the address while it would send the host key in clear text', () => {
    const of = host({ status: 200, json: {} });
    const row = draw(of).row('Online server address');
    const warning = 'Not encrypted: the host key is sent in clear text. Use https:// for a server on another machine.';
    expect(row.descEl.textContent).not.toContain(warning);
    typed(row, 'http://203.0.113.5:8787');
    expect(row.descEl.textContent).toContain(warning);
    typed(row, 'http://localhost:8787');
    expect(row.descEl.textContent).not.toContain(warning);
    typed(row, 'http://203.0.113.5:8787');
    typed(row, 'https://play.example.com');
    expect(row.descEl.textContent).not.toContain(warning);
  });

  it('show the account row only while Atlas\'s own server is set, following the address in the same open tab', () => {
    setServerOrigin('https://tables.example.com');
    const of = host({ status: 200, json: {} });
    const drawn = draw(of);
    // Self-hosted: the host key is the Host key row's, and no account row (or heading) is shown.
    expect(drawn.headings).toEqual(['Online server', 'Shared notes', 'Online diagnostics']);
    const account = drawn.row('Atlas account');
    const shown = (): boolean => account.settingEl.style.display !== 'none';
    expect(shown()).toBe(false);
    expect(drawn.row('Host key').settingEl.style.display).not.toBe('none');

    typed(drawn.row('Online server address'), UPSTREAM_RELAY_ORIGIN);
    expect(shown()).toBe(true);
    expect(buttonsOf(account)).toContain('Open account page');
    expect(drawn.row('Host key').settingEl.style.display).toBe('none');

    typed(drawn.row('Online server address'), 'https://tables.example.com');
    expect(shown()).toBe(false);
  });
});
