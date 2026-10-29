import { describe, expect, it, vi } from 'vitest';
import { t } from '../../../src/app/i18n/index.ts';
import { zh } from '../../../src/app/i18n/locales/zh/index.ts';
import type { Translation } from '../../../src/app/i18n/types.ts';
import { LANGUAGE_LOAD_TIMEOUT_MS, initLanguage } from '../../../apps/play/src/i18nInit.ts';

function storage(value: string | null): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  return { getItem: () => value, setItem: () => undefined };
}

function loaders(): { zh: ReturnType<typeof vi.fn<() => Promise<Translation>>>; ru: ReturnType<typeof vi.fn<() => Promise<Translation>>> } {
  return { zh: vi.fn(() => Promise.resolve(zh)), ru: vi.fn(() => Promise.reject(new Error('unused'))) };
}

describe('initLanguage', () => {
  it('renders zh after loading its chunk', async () => {
    const l = loaders();
    await expect(initLanguage(storage('zh'), 'en-US', l)).resolves.toBe('zh');
    expect(t('onlinePlay.tab.notes')).toBe('笔记');
  });

  it('picks the base language', async () => {
    const l = loaders();
    await expect(initLanguage(storage('obsidian'), 'zh-CN', l)).resolves.toBe('zh');
    expect(l.zh).toHaveBeenCalledTimes(1);
    expect(l.ru).not.toHaveBeenCalled();
  });

  it('falls back to English when the chunk fails', async () => {
    const l = { zh: vi.fn(() => Promise.reject(new Error('offline'))) };
    await expect(initLanguage(storage('zh'), 'zh-CN', l)).resolves.toBe('en');
    expect(t('onlinePlay.app.title')).toBe('Atlas online table');
  });

  it('speaks Chinese by default', async () => {
    await expect(initLanguage(null, 'en-US', loaders())).resolves.toBe('zh');
  });

  it('falls back to English when the chunk never arrives', async () => {
    vi.useFakeTimers();
    try {
      const pending = initLanguage(storage('zh'), 'en-US', { zh: () => new Promise<Translation>(() => undefined) });
      await vi.advanceTimersByTimeAsync(LANGUAGE_LOAD_TIMEOUT_MS);
      await expect(pending).resolves.toBe('en');
      expect(t('onlinePlay.app.title')).toBe('Atlas online table');
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls no loader for English', async () => {
    const l = loaders();
    await expect(initLanguage(storage('en'), 'zh-CN', l)).resolves.toBe('en');
    expect(l.zh).not.toHaveBeenCalled();
    expect(t('onlinePlay.app.title')).toBe('Atlas online table');
  });

  it('has the real loaders for every language but English', async () => {
    const { LAZY_TRANSLATIONS } = await import('../../../src/app/i18n/lazyLanguages.ts');
    expect(Object.keys(LAZY_TRANSLATIONS).sort()).toEqual(['ru', 'zh']);
  });
});
