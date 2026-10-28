import type { Application } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { GridOptions } from '../../../../src/app/grid/GridSystem.ts';
import { parseGridColor } from '../../../../src/app/grid/gridContrastColor.ts';
import type { SharedGrid } from '../../../../src/app/online/protocol/mapLayers.ts';

export function gridOptions(grid: SharedGrid): GridOptions {
  return {
    type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY,
    color: parseGridColor(grid.colour ?? undefined), alpha: grid.alpha, lineWidth: grid.lineWidth, lineType: grid.lineType,
    enabled: true, cellNumbers: grid.numbers ?? undefined,
  };
}

export function maxTextureSize(app: Application): number {
  const renderer = app.renderer;
  return 'gl' in renderer ? Number(renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE)) : 4096;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

/** The camera can always zoom out far enough to show the whole map, however large its world. */
export function applyZoomRange(viewport: Viewport, rect: { width: number; height: number }): void {
  const fitScale = Math.min(viewport.screenWidth / rect.width, viewport.screenHeight / rect.height);
  viewport.clampZoom({ minScale: Math.min(MIN_ZOOM, fitScale), maxScale: MAX_ZOOM });
}
