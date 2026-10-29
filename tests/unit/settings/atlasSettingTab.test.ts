// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { App, Plugin } from 'obsidian';
import { AtlasSettingTab } from '../../../src/app/settings/AtlasSettingTab';
import type { AtlasSettingSection } from '../../../src/app/settings/settingSections';

const api = vi.hoisted(() => ({ modern: true }));

vi.mock('obsidian', () => {
  class PluginSettingTab {
    containerEl = document.createElement('div');
    update?: () => void;
  }
  class Setting {
    constructor(el: HTMLElement) { el.appendChild(document.createElement('div')); }
    setName(): this { return this; }
    setHeading(): this { return this; }
    setDesc(): this { return this; }
  }
  return { PluginSettingTab, Setting, requireApiVersion: (): boolean => api.modern };
});

describe('AtlasSettingTab.refresh', () => {
  it('reads sections that grew after construction through update()', () => {
    api.modern = true;
    const sections: AtlasSettingSection[] = [{ heading: 'A', rows: [] }];
    const tab = new AtlasSettingTab({} as App, {} as Plugin, () => sections);
    let stored: unknown[] = [];
    tab.update = (): void => { stored = tab.getSettingDefinitions(); };
    tab.update();
    sections.push({ heading: 'Online', rows: [] });
    expect(stored).toHaveLength(1);
    tab.refresh();
    expect(stored).toHaveLength(2);
  });

  it('draws a shown tab anew where update() does not exist', () => {
    api.modern = false;
    const sections: AtlasSettingSection[] = [{ heading: 'A', rows: [] }];
    const tab = new AtlasSettingTab({} as App, {} as Plugin, () => sections);
    tab.refresh();
    expect(tab.containerEl.children).toHaveLength(0);
    tab.display();
    sections.push({ heading: 'Online', rows: [] });
    tab.refresh();
    expect(tab.containerEl.children).toHaveLength(2);
    tab.hide();
    sections.push({ heading: 'More', rows: [] });
    tab.refresh();
    expect(tab.containerEl.children).toHaveLength(2);
  });
});
