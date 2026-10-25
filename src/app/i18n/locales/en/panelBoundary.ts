import type { Message } from '../../types';

export const panelBoundary = {
  'panelBoundary.message': 'Atlas VTT could not show {name}. The rest of the map keeps working.',
  'panelBoundary.name.hotkeyHelp': 'the hotkey help',
  'panelBoundary.name.sceneTabs': 'the scene tabs',
  'panelBoundary.name.widgets': 'the widgets',
  'panelBoundary.name.diceRolls': 'the dice rolls',
  'panelBoundary.name.undoRedo': 'undo and redo',
  'panelBoundary.name.viewActions': 'the view actions',
  'panelBoundary.name.turnBanner': 'the turn banner',
  'panelBoundary.name.toolbar': 'the toolbar',
  'panelBoundary.name.sceneSwitcher': 'the scene switcher',
  'panelBoundary.name.gridSettings': 'the grid settings',
  'panelBoundary.name.gridAlignment': 'the grid alignment',
  'panelBoundary.name.dmScreen': 'the DM screen',
  'panelBoundary.name.diceLog': 'the dice log',
  'panelBoundary.name.initiativeTracker': 'the initiative tracker',
  'panelBoundary.name.randomTables': 'the random tables',
  'panelBoundary.name.lightSettings': 'the light settings',
  'panelBoundary.name.sceneLighting': 'the scene lighting',
  'panelBoundary.name.loadingOverlay': 'the loading overlay',
} as const satisfies Record<string, Message>;
