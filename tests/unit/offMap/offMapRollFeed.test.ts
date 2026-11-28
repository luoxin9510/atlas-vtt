import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/ui/notice', () => ({ showNotice: vi.fn() }));

import { offMapRollFeedOf } from '../../../src/app/services/offMapRollFeed';
import { OffMapRoller } from '../../../src/app/services/offMapRoller';

describe('the feed of an app\'s off-map rolls', () => {
  it('is the roller of the app, heard through the feed, until the roller is released', () => {
    const app = {} as never;
    expect(offMapRollFeedOf(app)).toBeUndefined();
    const roller = OffMapRoller.forApp(app);
    const heard: string[] = [];
    const stop = offMapRollFeedOf(app)?.onRoll(({ result }) => heard.push(result.formula));
    roller.roll('1d20', { doc: {} as Document });
    expect(heard).toEqual(['1d20']);
    stop?.();
    roller.roll('1d20', { doc: {} as Document });
    expect(heard).toHaveLength(1);
    OffMapRoller.release(app);
    expect(offMapRollFeedOf(app)).toBeUndefined();
  });
});
