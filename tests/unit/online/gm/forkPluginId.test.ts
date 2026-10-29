// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { atlasPlayerSettings } from '../../../../src/app/online/gm/atlasLighting.ts';
import { presentedScene, presentOnPlayerView } from '../../../../src/app/online/gm/presentedScene.ts';
import { atlasPluginId, setAtlasPluginId } from '../../../../src/app/plugin/pluginId';
import { SettingsService } from '../../../../src/app/services/SettingsService';

describe('Atlas running under the fork id', () => {
  afterEach(() => setAtlasPluginId(''));

  it('finds the scene binding, the present command and the settings under atlas-vtt-fork, and nothing under atlas-vtt', () => {
    setAtlasPluginId('atlas-vtt-fork');
    const settingsService = new SettingsService({} as never);
    settingsService.setLocalPlayerViewSettings({ showCursors: true });
    const executeCommandById = vi.fn((id: string): boolean => id === 'atlas-vtt-fork:send-map-to-player-view');
    const setActiveLeaf = vi.fn();
    const source = { get: () => ({ tabId: 't1', filePath: 'a.atlas' }), onChange: () => () => undefined };
    const app = {
      plugins: { plugins: { 'atlas-vtt-fork': { presentedScene: source, settingsService } } },
      commands: { executeCommandById },
      workspace: { setActiveLeaf },
    } as unknown as App;

    expect(presentedScene(app)).toEqual({ tabId: 't1', filePath: 'a.atlas' });
    expect(atlasPlayerSettings(app).showCursors).toBe(true);
    expect(presentOnPlayerView(app, {} as WorkspaceLeaf)).toBe(true);
    expect(executeCommandById).toHaveBeenCalledWith('atlas-vtt-fork:send-map-to-player-view');
  });

  it('resets to the upstream id', () => {
    setAtlasPluginId('atlas-vtt-fork');
    setAtlasPluginId('');
    expect(atlasPluginId()).toBe('atlas-vtt');
  });
});
