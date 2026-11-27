import { useEffect, useState } from 'react';
import type { App } from 'obsidian';
import { useAtlasStore } from '../ViewStoreContext';
import { useAtlasUI } from '../root/AtlasUIContext';
import { SettingsService } from '../../services/SettingsService';
import type { GmOnlyRolls } from '../components/dice/DiceTray';

/** Whether the tray rolls GM-only, kept current as the setting changes. */
function useRollsGmOnly(app: App | undefined): boolean {
  const settings = SettingsService.forApp(app);
  const [on, setOn] = useState(() => settings?.rollsGmOnly() ?? false);

  useEffect(() => {
    if (!settings) return;
    setOn(settings.rollsGmOnly());
    return settings.onChange(() => setOn(settings.rollsGmOnly()));
  }, [settings]);

  return on;
}

/**
 * The GM's "GM only" switch of the dice tray: a plugin setting, so it stays on across scenes and restarts until
 * switched off. Null in a player view, where nobody else watches the rolls.
 */
export function useGmOnlyRolls(): GmOnlyRolls | null {
  const { app, view } = useAtlasUI();
  const isPlayerView = useAtlasStore((state) => state.isPlayerView) || view?.getViewType?.() === 'atlas-vtt-player';
  const on = useRollsGmOnly(app ?? undefined);
  const settings = SettingsService.forApp(app ?? undefined);
  if (isPlayerView || !settings) return null;
  return { on, onToggle: () => settings.setRollsGmOnly(!on) };
}
