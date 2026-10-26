import type { RollMode } from '../protocol/index.ts';
import { Crown, EyeOff, UserRound, Users, type LucideIcon } from 'lucide-react';
import { t } from '../../i18n';

export interface RollModeInfo {
  /** As the roll-mode menu offers it. */
  readonly choice: string;
  /** As a private roll's badge says it; null for a public roll, which has none. */
  readonly badge: string | null;
  readonly icon: LucideIcon;
}

/** The roll modes as the panel names and draws them. */
export const ROLL_MODE_INFO: Readonly<Record<RollMode, RollModeInfo>> = {
  public: { choice: t('onlineLog.mode.public'), badge: null, icon: Users },
  gm: { choice: t('onlineLog.mode.gm'), badge: t('onlineLog.mode.gm'), icon: Crown },
  blind: { choice: t('onlineLog.mode.blindChoice'), badge: t('onlineLog.mode.blind'), icon: EyeOff },
  self: { choice: t('onlineLog.mode.selfChoice'), badge: t('onlineLog.mode.selfBadge'), icon: UserRound },
};
