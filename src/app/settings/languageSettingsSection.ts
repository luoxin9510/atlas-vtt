import type { AtlasSettingSection } from './settingSections';
import { t } from '../i18n';
import { readLanguageChoice, saveLanguageChoice, type ChoiceStorage, type LanguageChoice } from '../i18n/languageChoice';
import { showNotice } from '../ui/notice';

/** The language Atlas speaks on this device; it takes effect when Atlas loads again. */
export function languageSettingsSection(storage: ChoiceStorage | null): AtlasSettingSection {
  // Each language is named in itself, so it can be found whatever Atlas speaks now
  const labels: Record<LanguageChoice, string> = {
    zh: '简体中文',
    en: 'English',
    obsidian: t('settings.language.followObsidian'),
  };
  return {
    heading: t('settings.language.heading'),
    rows: [{
      name: t('settings.language.name'),
      desc: t('settings.language.desc'),
      aliases: ['language', 'chinese', 'english', '语言', '中文'],
      render: (setting) => {
        setting.addDropdown((dropdown) => {
          dropdown
            .addOptions(labels)
            .setValue(readLanguageChoice(storage))
            .onChange((value) => {
              saveLanguageChoice(storage, value as LanguageChoice);
              showNotice(t('settings.language.reloadNotice'));
            });
        });
      },
    }],
  };
}
