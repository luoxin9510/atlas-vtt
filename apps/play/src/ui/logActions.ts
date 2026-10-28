import type { PlayerMessage } from '../../../../src/app/online/protocol/index.ts';
import type { LogActions } from '../../../../src/app/online/tableLog/index.ts';
import type { Session } from '../app/session.ts';

/** The speaker key of the player themselves in the panel's list. */
const SELF_KEY = 'self';

/**
 * What the log panel does, as the messages a player sends. A roll needs a scene (the GM refuses one
 * for another); it is for the token the player chose as speaker, else their first own token, else nobody.
 */
export function logActions(
  rawSend: (body: PlayerMessage) => boolean,
  scene: () => string | null,
  token: () => string | null,
  onResult: (ok: boolean) => void = () => undefined,
): LogActions {
  // A message that could not go (not joined, GM away, too large) is reported, never dropped silently.
  const send = (body: PlayerMessage): void => onResult(rawSend(body));
  return {
    say(draft): void {
      send({
        t: 'chat', text: draft.text,
        ...(draft.reply !== undefined && { reply: draft.reply }),
        ...(draft.style !== undefined && { style: draft.style }),
        ...(draft.speaker !== undefined && draft.speaker !== SELF_KEY && { speaker: draft.speaker }),
        ...(draft.to !== undefined && { to: draft.to }),
      });
    },
    roll(draft): void {
      const id = scene();
      if (id === null) return;
      const speaker = draft.speaker !== undefined && draft.speaker !== SELF_KEY ? draft.speaker : null;
      send({
        t: 'roll', scene: id, formula: draft.formula, token: speaker ?? token(), mode: draft.mode,
        ...(draft.flavor !== undefined && { flavor: draft.flavor }),
        ...(draft.request !== undefined && { request: draft.request }),
      });
    },
    edit(id, text): void {
      send({ t: 'chat-edit', id, text });
    },
    remove(id): void {
      send({ t: 'chat-delete', id });
    },
    react(id, emoji, on): void {
      send({ t: 'react', id, emoji, on });
    },
  };
}

/** The actions of a session: its scene and the player's first own token are read when an action runs. */
export function sessionActions(session: Pick<Session, 'send' | 'store'>, onResult?: (ok: boolean) => void): LogActions {
  return logActions(
    (body) => session.send(body),
    () => session.store.getState().scene?.id ?? null,
    () => {
      const state = session.store.getState();
      return state.tokens.find((token) => state.mine.has(token.id))?.id ?? null;
    },
    onResult,
  );
}
