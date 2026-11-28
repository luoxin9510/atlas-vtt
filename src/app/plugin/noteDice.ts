import type { Plugin } from 'obsidian';
import { NoteDiceLayers } from '../services/NoteDiceLayers';
import { OffMapRoller } from '../services/offMapRoller';

/**
 * Dice with no map open: makes the app's off-map roller (`OffMapRoller`), which the statblock and
 * note dice links fall back on, and the layer that shows its rolls in the window they were made in.
 * A window that closes takes its host with it; unloading removes the rest and the roller.
 */
export function registerNoteDice(plugin: Plugin): void {
  const { app } = plugin;
  const layers = new NoteDiceLayers(app, OffMapRoller.forApp(app));
  layers.start();
  plugin.registerEvent(app.workspace.on('window-close', (_workspaceWindow, win) => layers.removeDocument(win.document)));
  plugin.register(() => {
    layers.dispose();
    OffMapRoller.release(app);
  });
}
