import { Container } from 'pixi.js';
import type { SharedAnnotations } from '../../../../src/app/online/protocol/mapLayers.ts';
import { DrawingLayer } from '../../../../src/app/pixi/drawingLayer.ts';
import { createTextElementView, updateTextElementView } from '../../../../src/app/pixi/textElementView.ts';
import { destroyTree } from '../../../../src/app/pixi/utils/destroyTree.ts';
import type { DrawingStroke } from '../../../../src/app/types.ts';
import { sharedDrawingToStroke, sharedTextToElement } from './annotationAdapter.ts';

/**
 * The drawings and texts the GM shared, in the annotations container: drawings below, texts above.
 * Entries are told apart by their place in the list; one that keeps its place keeps its display object.
 */
export class AnnotationLayer {
  private readonly drawings = new Container({ label: 'drawings', eventMode: 'none' });
  private readonly texts = new Container({ label: 'texts', eventMode: 'none' });
  private readonly drawingLayer = new DrawingLayer(this.drawings);
  private readonly textViews: Container[] = [];
  private shown: SharedAnnotations | null = null;

  constructor(container: Container) {
    container.addChild(this.drawings, this.texts);
  }

  sync(annotations: SharedAnnotations): void {
    if (annotations === this.shown) return;
    this.shown = annotations;
    const strokes: Record<string, DrawingStroke> = {};
    annotations.drawings.forEach((drawing, i) => { strokes[`d${i}`] = sharedDrawingToStroke(drawing, `d${i}`); });
    this.drawingLayer.sync(strokes);
    annotations.texts.forEach((text, i) => {
      const element = sharedTextToElement(text, `t${i}`);
      const view = this.textViews[i];
      if (view) updateTextElementView(view, element);
      else {
        const created = createTextElementView(element);
        created.eventMode = 'none';
        this.texts.addChild(created);
        this.textViews[i] = created;
      }
    });
    for (const view of this.textViews.splice(annotations.texts.length)) destroyTree(view);
  }

  destroy(): void {
    this.drawingLayer.destroy();
    this.shown = null;
    this.textViews.length = 0;
    destroyTree(this.drawings);
    destroyTree(this.texts);
  }
}
