// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/atlasViewType', () => ({ ATLAS_VIEW_TYPE: 'atlas-vtt' }));
vi.mock('../../../src/app/ui/notice', () => ({ showNotice: vi.fn() }));
vi.mock('../../../src/app/services/diceSets/collectionDiceSets', async () => {
  const { defaultDiceSet } = await import('../../../src/app/gameSystems/diceSetResolution');
  return { diceSetOfCollection: (): unknown => defaultDiceSet() };
});

import { OffMapRoller, type OffMapRolled } from '../../../src/app/services/offMapRoller';
import { attachDiceRolling, linkDiceIn } from '../../../src/app/services/statblockDiceLinks';
import { rollStatblockContest, rollStatblockDice, type OffMapRolls } from '../../../src/app/services/statblockRolls';

/** An app with the plugin's roller (or not) and, where asked, one open map whose dice tool records its rolls. */
function setup(options: { roller: boolean; map?: boolean }): { app: never; heard: OffMapRolled[]; mapRolls: string[] } {
  const mapRolls: string[] = [];
  const tool = { rollDice: (formula: string): never => { mapRolls.push(formula); return { formula } as never; } };
  const view = { containerEl: { isShown: () => true }, serviceManager: { getToolController: () => ({ getDiceTool: () => tool }) } };
  const app = { workspace: { getLeavesOfType: () => (options.map ? [{ view }] : []) }, vault: { getFileByPath: () => null } } as never;
  const heard: OffMapRolled[] = [];
  if (options.roller) OffMapRoller.forApp(app).onRoll((rolled) => heard.push(rolled));
  return { app, heard, mapRolls };
}

const apps: object[] = [];
afterEach(() => { apps.length = 0; document.body.empty(); });

describe('a statblock roll with no map open and no surface of its own', () => {
  it('rolls with the roller of the app, and announces it in the focused window', () => {
    const { app, heard } = setup({ roller: true });
    vi.stubGlobal('activeDocument', document);
    const result = rollStatblockDice(app, '1d20+3', { statblockPath: 'Notes/Goblin.md' }, null);
    expect(result?.formula).toBe('1d20+3');
    expect(heard).toHaveLength(1);
    expect(heard[0]?.doc).toBe(document);
    expect(heard[0]?.result.source).toMatchObject({ type: 'statblock', statblockPath: 'Notes/Goblin.md' });
    vi.unstubAllGlobals();
  });

  it('rolls a contest with it too, both sides announced', () => {
    const { app, heard } = setup({ roller: true });
    vi.stubGlobal('activeDocument', document);
    const pair = rollStatblockContest(app, { formula: '3d6 vs 12', source: {} }, { formula: '3d6 vs 14', source: {} });
    expect(pair).not.toBeNull();
    expect(heard).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('still rolls nothing where the plugin made no roller (a bare test app)', () => {
    const { app } = setup({ roller: false });
    expect(rollStatblockDice(app, '1d20', {}, null)).toBeNull();
  });

  it('rolls from a clicked note dice link, as a fence in reading view does', () => {
    const { app, heard } = setup({ roller: true });
    vi.stubGlobal('activeDocument', document);
    const el = document.body.createDiv();
    el.innerHTML = '<div class="statblock-item-container">Bite 1d6+2</div>';
    linkDiceIn(el);
    const dispose = attachDiceRolling(el, app, () => ({ statblockPath: 'Notes/Goblin.md' }));
    el.querySelector<HTMLElement>('.atlas-dice-link')!.click();
    expect(heard.map((rolled) => rolled.result.formula)).toEqual(['1d6+2']);
    dispose();
    vi.unstubAllGlobals();
  });
});

describe('with a map open', () => {
  it('goes to the map first, and the roller announces nothing', () => {
    const { app, heard, mapRolls } = setup({ roller: true, map: true });
    rollStatblockDice(app, '1d20', {}, null);
    expect(mapRolls).toEqual(['1d20']);
    expect(heard).toEqual([]);
  });

  it('keeps the surface that supplies its own rolls, even with the roller there', () => {
    const { app, heard } = setup({ roller: true });
    const own: OffMapRolls & { rolled: string[] } = {
      rolled: [],
      roll(formula, source) { this.rolled.push(formula); return { id: formula, timestamp: 0, formula, rolls: [], modifiers: 0, total: 1, source }; },
      show: () => undefined,
    };
    rollStatblockDice(app, '1d8', {}, own);
    expect(own.rolled).toEqual(['1d8']);
    expect(heard).toEqual([]);
  });

  it('does not show a roll of a map behind another tab on the layer', () => {
    const { app, heard } = setup({ roller: true, map: true });
    const hidden = (app as unknown as { workspace: { getLeavesOfType: () => Array<{ view: { containerEl: { isShown: () => boolean } } }> } }).workspace.getLeavesOfType()[0]!.view;
    hidden.containerEl.isShown = () => false;
    rollStatblockDice(app, '1d12', {}, null);
    expect(heard).toEqual([]);
  });
});
