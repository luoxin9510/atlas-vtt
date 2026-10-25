import React from 'react';
import type { TemplateReview } from '../../../../services/collectionBundle/importTemplates';
import { t } from '../../../../i18n';

interface TemplateCopiesProps {
  templates: TemplateReview;
  switchNotes: boolean;
  onSwitchNotesChange: (switchNotes: boolean) => void;
}

/** How many names a list shows before it says how many more there are. */
const SHOWN = 5;

function namesOf(names: readonly string[]): string {
  const shown = names.slice(0, SHOWN).join(', ');
  return names.length > SHOWN ? t('transfer.namesAndMore', { names: shown, count: names.length - SHOWN }) : shown;
}

/**
 * The collection's templates that come in as copies, since the vault's own versions differ,
 * and the choice for the statblocks the vault already had that use them: keep their template
 * (the default) or switch them to the copy.
 */
export function TemplateCopies({ templates, switchNotes, onSwitchNotesChange }: TemplateCopiesProps): React.JSX.Element | null {
  const { copies, reusedNotes } = templates;
  if (copies.length === 0) return null;
  return (
    <div className="atlas-transfer-callout" role="note">
      <strong>
        {copies.length === 1
          ? t('transfer.templateCopiesOne')
          : t('transfer.templateCopiesMany')}
      </strong>
      <ul>
        {copies.slice(0, SHOWN).map((copy) => <li key={copy.copyName}>{copy.name} → {copy.copyName}</li>)}
        {copies.length > SHOWN && <li>{t('common.andMore', { count: copies.length - SHOWN })}</li>}
      </ul>
      {reusedNotes.length > 0 && (
        <label className="atlas-transfer-checkbox">
          <input type="checkbox" checked={switchNotes} onChange={(event) => onSwitchNotesChange(event.target.checked)} />
          <span>
            {t('transfer.switchNotes', { count: reusedNotes.length, names: namesOf(reusedNotes.map((note) => note.name)) })}
          </span>
        </label>
      )}
    </div>
  );
}
