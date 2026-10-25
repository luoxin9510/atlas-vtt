import React from 'react';
import type { FieldChanges } from '../../../model/fieldOps';
import type { TemplateField } from '../../../model/templateTypes';
import type { EditorSession } from '../sessionTypes';
import { listFromText, sameList, textFromList } from './blockEdits';
import { SettingNote, SwitchSetting, TextSetting } from './InspectorControls';
import { t } from '../../../../i18n';

/** Where the inspector focuses the choices when a block asks for them (the toolbar's Kind of value). */
export const CHOICES_FOCUS_KEY = 'choices';

export interface ChoiceSettingsProps {
  field: TemplateField;
  session: EditorSession;
  readOnly: boolean;
  edit: (changes: FieldChanges) => void;
}

/** How a statblock's value reads, said once for the settings as they stand. */
function choiceExample(field: TemplateField): string {
  const [first = t('sbTemplateTable.opt.exampleOne'), second = t('sbTemplateTable.opt.exampleAnother')] = field.options ?? [];
  const unit = field.unit?.trim() ? ` ${field.unit.trim()}` : '';
  const pick = (option: string, number: number): string => (field.numbered ? `${option} ${number}${unit}` : option);
  return field.several ? `${pick(first, 60)}, ${pick(second, 30)}` : pick(first, 60);
}

/**
 * A choice's settings: the options a statblock picks from, whether it takes
 * other text too, several options at once, and a number with each (and that
 * number's unit). Every statblock still keeps the value as one line of text.
 */
export function ChoiceSettings({ field, session, readOnly, edit }: ChoiceSettingsProps): React.JSX.Element {
  return (
    <>
      <TextSetting
        label={t('sbTemplateTable.opt.choices')}
        value={textFromList(field.options)}
        placeholder={t('sbTemplateTable.opt.choicesPlaceholder')}
        session={session}
        disabled={readOnly}
        focusKey={CHOICES_FOCUS_KEY}
        onText={(text) => {
          const options = listFromText(text);
          if (!sameList(options, field.options)) edit({ options: options.length > 0 ? options : undefined });
        }}
      />
      <SwitchSetting label={t('sbTemplate.menu.pickSeveral')} value={field.several === true} onChange={(several) => edit({ several: several || undefined })} disabled={readOnly} />
      <SwitchSetting label={t('sbTemplate.menu.eachWithNumber')} value={field.numbered === true} onChange={(numbered) => edit({ numbered: numbered || undefined })} disabled={readOnly} />
      {field.numbered && (
        <TextSetting label={t('sbTemplateTable.opt.unit')} value={field.unit ?? ''} placeholder={t('sbTemplateTable.opt.unitPlaceholder')} session={session} disabled={readOnly}
          onText={(text) => edit({ unit: text.trim() ? text : undefined })} />
      )}
      <SwitchSetting label={t('sbTemplateTable.opt.allowOther')} value={field.open === true} onChange={(open) => edit({ open: open || undefined })} disabled={readOnly} />
      {(field.options?.length ?? 0) > 0 && <SettingNote>{t('sbTemplateTable.opt.choiceExample', { example: choiceExample(field) })}</SettingNote>}
    </>
  );
}
