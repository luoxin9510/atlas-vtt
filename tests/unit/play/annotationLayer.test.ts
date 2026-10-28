import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { AnnotationLayer } from '../../../apps/play/src/scene/annotationLayer.ts';

const pen = { type: 'pen', points: [0, 0, 10, 10], colour: '#ff0000', width: 4, opacity: 1 } as const;
const icon = { type: 'icon', points: [5, 5], colour: '#00ff00', width: 70, opacity: 1, icon: 'skull' } as const;

describe('AnnotationLayer', () => {
  it('survives an icon at an index becoming a pen stroke', () => {
    const root = new Container();
    const layer = new AnnotationLayer(root);
    layer.sync({ drawings: [icon, pen], texts: [] });
    expect(() => layer.sync({ drawings: [pen], texts: [] })).not.toThrow();
    const drawings = root.children[0] as Container;
    expect(drawings.children).toHaveLength(1);
    expect(drawings.children[0]).toBeInstanceOf(Graphics);
    layer.destroy();
  });
});
