import type { AtlasSettingSection } from '../../settings/settingSections';
import type { AccountControl } from './account/AccountControl.ts';
import { isSelfHosted, normalizeServerOrigin, setServerOrigin } from './servers.ts';
import type { OnlineSettings } from './settings.ts';
import { t } from '../../i18n';

/** Makes the setting's server the one online play talks to. */
export function applyServerSetting(settings: OnlineSettings): void {
  setServerOrigin(settings.serverOrigin === '' ? null : settings.serverOrigin);
}

export const SERVER_ADDRESS_HELP = t('onlineGm.server.addressHelp');
export const SERVER_ADDRESS_INVALID = t('onlineGm.server.addressInvalid');
const HOST_KEY_HELP = t('onlineGm.server.hostKeyHelp');

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
    heading: t('onlineGm.server.heading'),
    rows: [{
      name: t('onlineGm.server.addressName'),
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
      name: t('onlineGm.server.hostKeyName'),
      desc: HOST_KEY_HELP,
      render: (setting) => {
        const draw = (): void => {
          setting.clear();
          if (!isSelfHosted()) return setting.settingEl.hide();
          setting.settingEl.show();
          setting.addText((text) => {
            text.inputEl.type = 'password';
            text.inputEl.autocomplete = 'off';
            text.setPlaceholder(host.account.token() !== null ? t('onlineGm.server.hostKeyReplace') : t('onlineGm.server.hostKeyPaste'));
            text.inputEl.addEventListener('change', () => {
              const key = text.inputEl.value;
              text.setValue('');
              // Emptying the field does not clear the key by accident: the Remove button does.
              if (key.trim() === '') return;
              host.account.setHostKey(key);
              draw();
            });
          });
          if (host.account.token() !== null) setting.addButton((button) => button.setButtonText(t('onlineGm.server.hostKeyRemove')).onClick(() => (host.account.setHostKey(''), draw())));
        };
        draw();
        redraws.add(draw);
        return () => redraws.delete(draw);
      },
    }],
  }];
}
