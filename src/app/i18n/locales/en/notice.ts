import type { Message } from '../../types';

export const notice = {
  'notice.dashboardOpenFailed': 'Error opening the dashboard',
  'notice.openImageFirst': 'Please open an image file first',
  'notice.sceneNotSaved': 'Atlas VTT could not finish saving {name}. Its latest changes may be missing from its file.',
  'notice.notAnAtlasScene': '"{name}" is not an Atlas scene. To play on a map image, create a scene from it in the asset manager.',
  'notice.noSceneOpen': 'No scene is open. Open a scene to add tokens to it.',
  'notice.sceneStillLoading': 'The scene is still loading. Add the tokens once it is open.',
  'notice.softwareRendering': 'Atlas cannot use your graphics card, so maps are drawn without it: they may be slower, and outlines, glows and some effects are missing. Turn on hardware acceleration in Obsidian\'s general settings, or check your graphics drivers.',
} as const satisfies Record<string, Message>;
