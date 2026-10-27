import type { SharedDrawing, SharedText } from '../../../../src/app/online/protocol/mapLayers.ts';
import type { DrawingStroke, TextElement } from '../../../../src/app/types.ts';

/** A shared drawing as the Atlas stroke the drawing helpers draw (the inverse of the GM's `sharedDrawing`). */
export function sharedDrawingToStroke(drawing: SharedDrawing, id = 'shared'): DrawingStroke {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < drawing.points.length; i += 2) points.push({ x: drawing.points[i]!, y: drawing.points[i + 1]! });
  const stroke: DrawingStroke = { id, kind: 'drawing', timestamp: 0, type: drawing.type, points, color: drawing.colour, width: drawing.width, opacity: drawing.opacity };
  if (drawing.type === 'icon' && drawing.icon !== undefined) stroke.icon = drawing.icon;
  return stroke;
}

/** A shared text as the Atlas text element the text view draws (the inverse of the GM's `sharedText`). */
export function sharedTextToElement(text: SharedText, id = 'shared'): TextElement {
  const element: TextElement = {
    id, kind: 'text', x: text.x, y: text.y, text: text.text, fontSize: text.fontSize, fontFamily: text.fontFamily, color: text.colour,
    padding: text.padding, borderRadius: text.radius, opacity: text.opacity, align: text.align, bold: text.bold, italic: text.italic,
    rotation: text.rotation, scale: text.scale,
  };
  if (text.background !== null) element.backgroundColor = text.background;
  return element;
}
