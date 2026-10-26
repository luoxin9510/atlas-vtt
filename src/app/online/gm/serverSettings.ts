import type { AtlasSettingSection } from '../../settings/settingSections';
import type { AccountControl } from './account/AccountControl.ts';
import { isSelfHosted, normalizeServerOrigin, setServerOrigin } from './servers.ts';
import type { OnlineSettings } from './settings.ts';

/** Makes the setting's server the one online play talks to. */
export function applyServerSetting(settings: OnlineSettings): void {
  setServerOrigin(settings.serverOrigin === '' ? null : settings.serverOrigin);
}

export const SERVER_ADDRESS_HELP = 'The address of the server you host online tables on. Leave it empty to keep online play off.';
export const SERVER_ADDRESS_INVALID = 'Enter an address such as https://play.example.com.';
const HOST_KEY_HELP = 'The key your server gave you for hosting tables. It stays in Obsidian\'s secret storage on this device.';

/** What the server section's rows read and change. */
export interface ServerSettingsHost {
  readonly settings: OnlineSettings;
  readonly account: AccountControl;
  saveSettings(): Promise<void>;
}

/**
 * The settings' server section: the table server's address, and, while it is not Atlas's own, the
 * host key that stands in for an account. Both are taken when the field is left (`change`), the key
 * is never shown back, and an address that is none changes nothing.
 */
export function serverSections(host: ServerSettingsHost): AtlasSettingSection[] {
  const redraws = new Set<() => void>();
  const changed = (): void => {
    host.account.serverChanged();
    for (const redraw of redraws) redraw();
  };
  return [{
    heading: 'Online server',
    rows: [{
      name: 'Online server address',
      desc: SERVER_ADDRESS_HELP,
      render: (setting) => {
        setting.addText((text) => {
          text.setPlaceholder('https://play.example.com').setValue(host.settings.serverOrigin);
          text.inputEl.addEventListener('change', () => {
            const typed = text.inputEl.value.trim();
            const origin = typed === '' ? '' : normalizeServerOrigin(typed);
            if (origin === null) return void setting.setDesc(SERVER_ADDRESS_INVALID);
            setting.setDesc(SERVER_ADDRESS_HELP);
            text.setValue(origin);
            host.settings.serverOrigin = origin;
            applyServerSetting(host.settings);
            changed();
            void host.saveSettings();
          });
        });
      },
    }, {
      name: 'Host key',
      desc: HOST_KEY_HELP,
      render: (setting) => {
        const draw = (): void => {
          setting.clear();
          if (!isSelfHosted()) return setting.settingEl.hide();
          setting.settingEl.show();
          setting.addText((text) => {
            text.inputEl.type = 'password';
            text.inputEl.autocomplete = 'off';
            text.setPlaceholder(host.account.token() !== null ? 'Host key set. Paste a new one to replace it.' : 'Paste the host key');
            text.inputEl.addEventListener('change', () => {
              const key = text.inputEl.value;
              text.setValue('');
              host.account.setHostKey(key);
              draw();
            });
          });
          if (host.account.token() !== null) setting.addButton((button) => button.setButtonText('Remove').onClick(() => (host.account.setHostKey(''), draw())));
        };
        draw();
        redraws.add(draw);
        return () => redraws.delete(draw);
      },
    }],
  }];
}
