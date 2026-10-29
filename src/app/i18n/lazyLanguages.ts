import type { Translation } from './types';

/**
 * Languages other than English as loaders, keyed like `TRANSLATIONS`: each `import()` is its own chunk,
 * so a page that speaks one language downloads only that one. English is always bundled with `t()`.
 */
export const LAZY_TRANSLATIONS: Readonly<Record<string, () => Promise<Translation>>> = {
  ru: async (): Promise<Translation> => (await import('./locales/ru/index.ts')).ru,
  zh: async (): Promise<Translation> => (await import('./locales/zh/index.ts')).zh,
};
