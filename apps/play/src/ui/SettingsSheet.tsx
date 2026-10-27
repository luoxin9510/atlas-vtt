import type { ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';
import type { LanguageChoice } from '../../../../src/app/i18n/languageChoice.ts';
import { LegalLinks } from './LegalLinks.tsx';

export interface SettingsSheetProps {
  /** `zh` or `en`: the language in use. */
  language: string;
  lowPower: boolean;
  ownCode: string | null;
  onLanguage(choice: LanguageChoice): void;
  onLowPower(on: boolean): void;
  onClose(): void;
}

/** Language, low-power mode, the own code and the legal links, as a bottom sheet (a side panel on wide screens). */
export function SettingsSheet({ language, lowPower, ownCode, onLanguage, onLowPower, onClose }: SettingsSheetProps): ReactElement {
  return (
    <section className="atlas-play-sheet" role="dialog" aria-label={t('onlinePlay.settings.title')}>
      <header>
        <h2>{t('onlinePlay.settings.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('onlinePlay.settings.close')}>×</button>
      </header>
      <label>
        <span>{t('onlinePlay.settings.language')}</span>
        <select value={language.startsWith('zh') ? 'zh' : 'en'} onChange={(event) => onLanguage(event.target.value === 'en' ? 'en' : 'zh')}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="atlas-play-switch">
        <input type="checkbox" checked={lowPower} onChange={(event) => onLowPower(event.target.checked)} />
        <span>{t('onlinePlay.settings.lowPower')}</span>
      </label>
      {ownCode !== null ? <p>{t('onlinePlay.settings.ownCode')}: <strong>{ownCode}</strong></p> : null}
      <LegalLinks />
    </section>
  );
}
