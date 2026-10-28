import { describe, expect, it } from 'vitest';
import type { SharedDrawing, SharedText } from '../../../src/app/online/protocol/mapLayers.ts';
import type { DrawingStroke, TextElement } from '../../../src/app/types.ts';
import { sharedDrawingToStroke, sharedTextToElement } from '../../../apps/play/src/scene/annotationAdapter.ts';

describe('sharedDrawingToStroke', () => {
  it('turns the flat points of a pen drawing into points and keeps colour, width and opacity', () => {
    const shared: SharedDrawing = { type: 'pen', points: [1, 2, 3, 4, 5, 6], colour: '#ff0000', width: 6, opacity: 0.5 };
    const expected: DrawingStroke = { id: 'd', kind: 'drawing', timestamp: 0, type: 'pen', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], color: '#ff0000', width: 6, opacity: 0.5 };
    expect(sharedDrawingToStroke(shared, 'd')).toEqual(expected);
  });

  it('keeps the icon key and the one point of an icon stamp', () => {
    const shared: SharedDrawing = { type: 'icon', points: [40, 50], colour: '#00ff00', width: 70, opacity: 1, icon: 'skull' };
    const expected: DrawingStroke = { id: 'd', kind: 'drawing', timestamp: 0, type: 'icon', points: [{ x: 40, y: 50 }], color: '#00ff00', width: 70, opacity: 1, icon: 'skull' };
    expect(sharedDrawingToStroke(shared, 'd')).toEqual(expected);
  });

  it('gives a pen drawing no icon key', () => {
    expect('icon' in sharedDrawingToStroke({ type: 'pen', points: [0, 0], colour: '#000000', width: 1, opacity: 1 })).toBe(false);
  });
});

describe('sharedTextToElement', () => {
  const shared: SharedText = {
    x: 10, y: 20, text: 'Hello\nthere', fontSize: 24, fontFamily: 'Georgia', colour: '#112233', background: '#445566', padding: 5, radius: 3,
    opacity: 0.8, align: 'left', bold: true, italic: true, rotation: 45, scale: 2,
  };

  it('maps every field', () => {
    const expected: TextElement = {
      id: 't', kind: 'text', x: 10, y: 20, text: 'Hello\nthere', fontSize: 24, fontFamily: 'Georgia', color: '#112233', backgroundColor: '#445566',
      padding: 5, borderRadius: 3, opacity: 0.8, align: 'left', bold: true, italic: true, rotation: 45, scale: 2,
    };
    expect(sharedTextToElement(shared, 't')).toEqual(expected);
  });

  it('leaves the background out when there is none', () => {
    expect('backgroundColor' in sharedTextToElement({ ...shared, background: null })).toBe(false);
  });
});
