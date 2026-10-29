// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import { PlayApp } from '../../../apps/play/src/app/PlayApp.tsx';

afterEach(cleanup);

describe('PlayApp', () => {
  it('says the page must be opened over https, with the legal links, instead of the join form', async () => {
    await initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');
    render(<PlayApp session={null} language="en" lowPower storage={null} reload={() => undefined} secure={false} />);
    expect(screen.getByRole('alert').textContent).toBe('This page must be opened over https');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Source' })).toBeTruthy();
  });

  it('says it in Chinese by default', async () => {
    await initLanguage(null, 'zh-CN');
    render(<PlayApp session={null} language="zh" lowPower storage={null} reload={() => undefined} secure={false} />);
    expect(screen.getByRole('alert').textContent).toBe('此页面需要通过 https 打开');
  });

  it('still asks for the table link when the page is secure but has none', async () => {
    await initLanguage(null, 'zh-CN');
    render(<PlayApp session={null} language="zh" lowPower storage={null} reload={() => undefined} />);
    expect(screen.getByText('请从主持人给的链接打开')).toBeTruthy();
  });
});
