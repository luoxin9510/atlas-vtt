import { App, Plugin, PluginSettingTab, requireApiVersion, Setting, type SettingDefinitionItem } from 'obsidian';
import type { AtlasSettingSection } from './settingSections';

/** Renders the sections the plugin composes; it does not know which services exist. */
export class AtlasSettingTab extends PluginSettingTab {
  private cleanups: Array<() => void> = [];
  /** True between `display()` and `hide()`: only then is there anything on screen to redraw. */
  private shown = false;

  constructor(app: App, plugin: Plugin, private readonly sections: () => AtlasSettingSection[]) {
    super(app, plugin);
  }

  /** Obsidian 1.13+: declarative settings, indexed by the settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map(({ heading, rows }) => ({
      type: 'group' as const,
      heading,
      items: rows.map(({ render, ...row }) => ({ ...row, render: (setting: Setting) => render(setting) })),
    }));
  }

  /**
   * The sections grew or shrank (online play's data was read, its switch changed). Obsidian 1.13+
   * reads `getSettingDefinitions` once, in `addSettingTab`, so `update()` reads it again; before
   * 1.13 there is no `update`, so a tab on screen is drawn anew.
   */
  refresh(): void {
    if (requireApiVersion('1.13.0')) this.update();
    else if (this.shown) this.render();
  }

  /** Obsidian before 1.13 never calls `getSettingDefinitions`, so render the same sections by hand. */
  display(): void {
    this.render();
  }

  private render(): void {
    this.hide();
    this.shown = true;
    this.containerEl.empty();
    for (const { heading, rows } of this.sections()) {
      new Setting(this.containerEl).setName(heading).setHeading();
      for (const row of rows) {
        const setting = new Setting(this.containerEl).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);
        const cleanup = row.render(setting);
        if (cleanup) this.cleanups.push(cleanup);
      }
    }
  }

  hide(): void {
    this.shown = false;
    this.cleanups.splice(0).forEach(cleanup => cleanup());
  }
}
