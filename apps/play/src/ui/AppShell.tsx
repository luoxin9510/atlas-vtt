import type { ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';
import { LegalLinks } from './LegalLinks.tsx';

export function AppShell(): ReactElement {
  return (
    <main className="atlas-play-shell">
      <h1>{t('onlinePlay.app.title')}</h1>
      <LegalLinks />
    </main>
  );
}
