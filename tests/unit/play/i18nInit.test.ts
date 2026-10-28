import { describe, expect, it } from 'vitest';
import { t } from '../../../src/app/i18n/index.ts';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';

function storage(value: string | null): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  return { getItem: () => value, setItem: () => undefined };
}

describe('initLanguage', () => {
  it('speaks Chinese by default', () => {
    expect(initLanguage(null, 'en-US')).toBe('zh');
    expect(t('onlinePlay.app.title')).toBe('Atlas 联机桌');
  });

  it('honours a stored English choice', () => {
    expect(initLanguage(storage('en'), 'zh-CN')).toBe('en');
    expect(t('onlinePlay.app.title')).toBe('Atlas online table');
  });

  it('follows the browser when the choice is obsidian', () => {
    expect(initLanguage(storage('obsidian'), 'en-GB')).toBe('en');
  });
});
