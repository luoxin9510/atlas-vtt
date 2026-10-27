import { ERROR_REPORTS_KEPT_DAYS, type FeedbackSender } from '../protocol/index.ts';
import { t } from '../../i18n';

/** What the GM is told about the companion's error reports, beside their switch. */
export const COMPANION_REPORTS_NOTE = t('onlineGm.diagnostics.reportsNote', { days: ERROR_REPORTS_KEPT_DAYS });

/** Feedback, and the switch for error reports, as the online panel offers them. */
export interface CompanionFeedback extends FeedbackSender {
  reportsErrors(): boolean;
  setReportErrors(on: boolean): void;
}
