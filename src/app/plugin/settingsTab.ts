import type { Plugin } from 'obsidian';
import type { ChangelogService } from '../changelog/ChangelogService';
import { TileDecoderClient } from '../pixi/mapImage/TileDecoderClient';
import type { SettingsService } from '../services/SettingsService';
import { AtlasSettingTab } from '../settings/AtlasSettingTab';
import { changelogSettingsSection } from '../settings/changelogSettingsSection';
import { diceSettingsSection } from '../settings/diceSettingsSection';
import { hotkeySettingsSection, onboardingSettingsSection } from '../settings/hotkeySettingsSection';
import { languageSettingsSection } from '../settings/languageSettingsSection';
import { lightingSettingsSection } from '../settings/lightingSettingsSection';
import { mapImageCacheSettingsSection } from '../settings/mapImageCacheSettingsSection';
import { navigationSettingsSection } from '../settings/navigationSettingsSection';
import { supportSettingsSection } from '../settings/supportSettingsSection';
import type { IssueReporter } from '../support/IssueReporter';
import type { UpdateWatch } from '../updates/UpdateWatch';
import { deviceStorage } from './host/deviceStorage';
import { registerOnlinePlay, type OnlinePlay } from './onlinePlay';

/** What the settings tab shows and what online play needs of the plugin's services. */
export interface SettingsTabServices {
  settingsService: SettingsService;
  changelogService: ChangelogService;
  updateWatch: UpdateWatch;
  issueReporter: IssueReporter;
}

/**
 * Registers online play and Atlas's settings tab, whose sections include online play's (shown only
 * while it is switched on, so a change of them refreshes the tab). Returns online play.
 */
export function registerSettingsTab(plugin: Plugin, services: SettingsTabServices): OnlinePlay {
  const { settingsService, changelogService, updateWatch, issueReporter } = services;
  let settingTab: AtlasSettingTab | null = null;
  const onlinePlay = registerOnlinePlay(plugin, settingsService, () => settingTab?.refresh());
  settingTab = new AtlasSettingTab(plugin.app, plugin, () => [
    languageSettingsSection(deviceStorage()),
    navigationSettingsSection(settingsService),
    diceSettingsSection(settingsService),
    lightingSettingsSection(settingsService),
    mapImageCacheSettingsSection(() => TileDecoderClient.forApp(plugin.app)),
    hotkeySettingsSection(settingsService),
    onboardingSettingsSection(settingsService),
    changelogSettingsSection(settingsService, changelogService, plugin.manifest.version, updateWatch),
    ...onlinePlay.settingsSections(),
    supportSettingsSection(issueReporter),
  ]);
  plugin.addSettingTab(settingTab);
  return onlinePlay;
}
