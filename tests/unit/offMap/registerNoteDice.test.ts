// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/react/components/dice/DiceRollDisplay', () => ({ DiceRollDisplay: (): null => null }));
vi.mock('../../../src/app/services/diceSets/collectionDiceSets', async () => {
  const { defaultDiceSet } = await import('../../../src/app/gameSystems/diceSetResolution');
  return { diceSetOfCollection: (): unknown => defaultDiceSet() };
});

import { registerNoteDice } from '../../../src/app/plugin/noteDice';
import { OffMapRoller } from '../../../src/app/services/offMapRoller';

/** A plugin that records what it was asked to register, and lets the test fire its events and unload it. */
function fakePlugin(): { plugin: never; app: object; fire: (name: string, ...args: unknown[]) => void; unload: () => void } {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const cleanups: Array<() => void> = [];
  const app = { workspace: { on: (name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); return { name }; } } };
  const plugin = { app, registerEvent: (): void => undefined, register: (cleanup: () => void): void => { cleanups.push(cleanup); } };
  return {
    plugin: plugin as never, app,
    fire: (name, ...args) => handlers.get(name)?.(...args),
    unload: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

const layerOf = (doc: Document): HTMLElement | null => doc.body.querySelector('.atlas-note-dice-layer');

describe('the workspace dice layer, registered by the plugin', () => {
  it('makes the roller of the app, and drops its host when its window closes', () => {
    const { plugin, app, fire, unload } = fakePlugin();
    registerNoteDice(plugin);
    const roller = OffMapRoller.existing(app as never);
    expect(roller).toBeDefined();
    roller!.roll('1d20', { doc: document });
    expect(layerOf(document)).not.toBeNull();
    fire('window-close', {}, { document });
    expect(layerOf(document)).toBeNull();
    unload();
  });

  it('removes the hosts and the roller when the plugin unloads', () => {
    const { plugin, app, unload } = fakePlugin();
    registerNoteDice(plugin);
    OffMapRoller.existing(app as never)!.roll('1d20', { doc: document });
    expect(layerOf(document)).not.toBeNull();
    unload();
    expect(layerOf(document)).toBeNull();
    expect(OffMapRoller.existing(app as never)).toBeUndefined();
  });
});
