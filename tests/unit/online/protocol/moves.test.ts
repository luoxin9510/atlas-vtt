import { describe, expect, it } from 'vitest';
import { parseGmMessage } from '../../../../src/app/online/protocol/index.ts';

const base = { t: 'move-refused', scene: 's1', id: 'a'.repeat(24), x: 1, y: 2 };

describe('move-refused reasons', () => {
  it('keeps the paused and turn reasons', () => {
    expect(parseGmMessage({ ...base, reason: 'paused' })).toMatchObject({ reason: 'paused' });
    expect(parseGmMessage({ ...base, reason: 'turn' })).toMatchObject({ reason: 'turn' });
  });

  it('drops an unknown reason', () => {
    const parsed = parseGmMessage({ ...base, reason: 'x' });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('reason');
  });
});
