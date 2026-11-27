// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { SettingsService } from '../../src/app/services/SettingsService';
import { memoryPluginData } from '../mocks/pluginData';

async function loaded(stored: unknown = null, app = new App()): Promise<{ settings: SettingsService; data: ReturnType<typeof memoryPluginData>; app: App }> {
  const data = memoryPluginData(stored);
  const settings = new SettingsService(app, undefined, data);
  await settings.initialize();
  return { settings, data, app };
}

describe('the GM-only rolls switch', () => {
  it('is off until the GM switches it on, and reads anything but true as off', async () => {
    expect((await loaded()).settings.rollsGmOnly()).toBe(false);
    expect((await loaded({ rollsGmOnly: 'yes' })).settings.rollsGmOnly()).toBe(false);
  });

  it('stays on across restarts until it is switched off, and tells every listener', async () => {
    const { settings, data, app } = await loaded();
    const heard = vi.fn();
    settings.onChange(heard);
    settings.setRollsGmOnly(true);
    await settings.saveSettingsNow();
    expect(heard).toHaveBeenCalled();
    expect(data.stored()).toMatchObject({ rollsGmOnly: true });

    const reopened = new SettingsService(app, undefined, data);
    await reopened.initialize();
    expect(reopened.rollsGmOnly()).toBe(true);

    reopened.setRollsGmOnly(false);
    await reopened.saveSettingsNow();
    const again = new SettingsService(app, undefined, data);
    await again.initialize();
    expect(again.rollsGmOnly()).toBe(false);
  });
});
