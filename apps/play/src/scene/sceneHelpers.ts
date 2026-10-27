import type { Application } from 'pixi.js';
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
