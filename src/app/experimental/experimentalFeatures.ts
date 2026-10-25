import type { App } from 'obsidian';
import { SettingsService } from '../services/SettingsService';
import { t } from '../i18n';

/**
 * Features the GM switches on in the command palette's Experimental features page. All are off
 * until then, and the choice is stored in Atlas' settings (`AtlasSettings.experimental`) under
 * the feature's id, so never rename one.
 */
export const EXPERIMENTAL_FEATURES = [
  {
    id: 'statblockEditor',
    label: t('experimental.statblockEditor.label'),
    hint: t('experimental.statblockEditor.hint'),
  },
  {
    id: 'onlinePlay',
    label: t('experimental.onlinePlay.label'),
    hint: t('experimental.onlinePlay.hint'),
  },
] as const;

export type ExperimentalFeatureId = (typeof EXPERIMENTAL_FEATURES)[number]['id'];

/** Whether the GM switched the feature on; off wherever Atlas' settings cannot be reached. */
export function experimentalFeatureOn(app: App | undefined, id: ExperimentalFeatureId): boolean {
  return SettingsService.forApp(app)?.isExperimentalOn(id) ?? false;
}
