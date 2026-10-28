import { describe, expect, it, vi } from 'vitest';
import { logActions } from '../../../apps/play/src/ui/logActions.ts';

function setup(scene: string | null = 'scene-1', token: string | null = 'tok-1'): { send: ReturnType<typeof vi.fn>; actions: ReturnType<typeof logActions> } {
  const send = vi.fn(() => true);
  return { send, actions: logActions(send, () => scene, () => token) };
}

describe('logActions', () => {
  it('says a message with only what was given', () => {
    const { send, actions } = setup();
    actions.say({ text: 'Hi' });
    expect(send).toHaveBeenLastCalledWith({ t: 'chat', text: 'Hi' });
    actions.say({ text: 'Psst', reply: 'r1', style: 'ooc', speaker: 'tok-9', to: ['p1'] });
    expect(send).toHaveBeenLastCalledWith({ t: 'chat', text: 'Psst', reply: 'r1', style: 'ooc', speaker: 'tok-9', to: ['p1'] });
  });

  it('speaks as oneself when the speaker is the self entry', () => {
    const { send, actions } = setup();
    actions.say({ text: 'Hi', speaker: 'self' });
    expect(send).toHaveBeenLastCalledWith({ t: 'chat', text: 'Hi' });
  });

  it('rolls in the scene for the first own token, passing the mode through', () => {
    const { send, actions } = setup();
    actions.roll({ formula: '1d20', mode: 'blind', flavor: 'Spot' });
    expect(send).toHaveBeenLastCalledWith({ t: 'roll', scene: 'scene-1', formula: '1d20', token: 'tok-1', mode: 'blind', flavor: 'Spot' });
  });

  it('rolls for nobody without a token, and for the chosen speaker over the first token', () => {
    const none = setup('scene-1', null);
    none.actions.roll({ formula: '1d6', mode: 'public' });
    expect(none.send).toHaveBeenLastCalledWith({ t: 'roll', scene: 'scene-1', formula: '1d6', token: null, mode: 'public' });
    const chosen = setup();
    chosen.actions.roll({ formula: '1d6', mode: 'self', speaker: 'tok-2' });
    expect(chosen.send).toHaveBeenLastCalledWith({ t: 'roll', scene: 'scene-1', formula: '1d6', token: 'tok-2', mode: 'self' });
  });

  it('sends no roll without a scene', () => {
    const { send, actions } = setup(null);
    actions.roll({ formula: '1d20', mode: 'public' });
    expect(send).not.toHaveBeenCalled();
  });

  it('edits, removes and reacts', () => {
    const { send, actions } = setup();
    actions.edit('m1', 'new');
    expect(send).toHaveBeenLastCalledWith({ t: 'chat-edit', id: 'm1', text: 'new' });
    actions.remove('m1');
    expect(send).toHaveBeenLastCalledWith({ t: 'chat-delete', id: 'm1' });
    actions.react('m1', '👍', true);
    expect(send).toHaveBeenLastCalledWith({ t: 'react', id: 'm1', emoji: '👍', on: true });
  });

  it('reports a message that could not be sent, and one that could', () => {
    const results: boolean[] = [];
    let ok = false;
    const actions = logActions(() => ok, () => 'scene-1', () => null, (result) => results.push(result));
    actions.say({ text: 'Hi' });
    ok = true;
    actions.react('m1', '👍', true);
    expect(results).toEqual([false, true]);
  });
});
