import type { AtlasSettingSection } from '../../settings/settingSections';
import type { AccountControl } from './account/AccountControl.ts';
import { accountSections } from './account/accountSettings.ts';
import { COMPANION_REPORTS_NOTE } from './companionReports.ts';
import { normalizeServerOrigin } from './servers.ts';
import { serverSections } from './serverSettings.ts';

export interface OnlineSettings {
  /** Whether this plugin's errors are reported to the server; off until the GM switches it on. */
  reportErrors: boolean;
  /** The table server's origin as `normalizeServerOrigin` made it; empty: none is set, and online play is unavailable. */
  serverOrigin: string;
}

export const DEFAULT_SETTINGS: OnlineSettings = { reportErrors: false, serverOrigin: '' };

/** Settings read from the plugin's data, each field checked. */
export function readSettings(data: unknown): OnlineSettings {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const origin = typeof record.serverOrigin === 'string' ? normalizeServerOrigin(record.serverOrigin) : null;
  return { reportErrors: record.reportErrors === true, serverOrigin: origin ?? '' };
}

/** What online play's settings rows read and change. */
export interface OnlineSettingsHost {
  readonly settings: OnlineSettings;
  readonly account: AccountControl;
  saveSettings(): Promise<void>;
}

/** Online play's sections of Atlas's settings: the account and error reports. */
export function onlineSettingsSections(host: OnlineSettingsHost): AtlasSettingSection[] {
  const save = async (change: (settings: OnlineSettings) => void): Promise<void> => {
    change(host.settings);
    await host.saveSettings();
  };
  const settings = host.settings;
  return [
    ...serverSections(host),
    ...accountSections(host.account),
    {
      heading: 'Online diagnostics',
      rows: [{
        name: 'Send error reports',
        desc: COMPANION_REPORTS_NOTE,
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(settings.reportErrors).onChange((value) => void save((current) => (current.reportErrors = value))));
        },
      }],
    },
  ];
}
