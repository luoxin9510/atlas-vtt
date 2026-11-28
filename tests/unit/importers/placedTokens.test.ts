import { describe, expect, it } from 'vitest';
import { placedTokenChanges, reimportedMapJson } from '../../../src/app/importers/placedTokens';
import { HP, STR } from '../../mocks/resourceFixtures';

const NOTE = 'atlas-vtt/collections/crew/characters/Robin.md';

const mapOf = (tokens: Record<string, object>, version = 4): string => JSON.stringify({ version, state: { objects: { tokens } } });
const tokensOf = (json: string | null): Record<string, Record<string, unknown>> =>
  (JSON.parse(json ?? '{}') as { state: { objects: { tokens: Record<string, Record<string, unknown>> } } }).state.objects.tokens;
const plan = { notePath: NOTE, record: { hp: 15 } as Record<string, unknown>, definitions: [HP, STR], oldImage: null, newImage: null };

describe('placed tokens after a re-import', () => {
  it('clamps current damage to the new maximum and keeps lower values', () => {
    const json = mapOf({
      a: { id: 'a', statblockPath: NOTE, hp: { current: 20, max: 27 } },
      b: { id: 'b', statblockPath: NOTE, hp: { current: 5, max: 27 } },
    });
    const tokens = tokensOf(reimportedMapJson(json, plan));
    expect(tokens.a?.hp).toEqual({ current: 15, max: 15 });
    expect(tokens.b?.hp).toEqual({ current: 5, max: 15 });
  });

  it('leaves conditions and tokens of other notes alone', () => {
    const json = mapOf({
      a: { id: 'a', statblockPath: NOTE, hp: { current: 20, max: 27 }, conditions: ['prone'], conditionValues: { frightened: 2 } },
      other: { id: 'other', statblockPath: 'elsewhere.md', hp: { current: 20, max: 27 } },
    });
    const tokens = tokensOf(reimportedMapJson(json, plan));
    expect(tokens.a).toMatchObject({ conditions: ['prone'], conditionValues: { frightened: 2 } });
    expect(tokens.other?.hp).toEqual({ current: 20, max: 27 });
  });

  it('returns null when no token changes, so the map is not written', () => {
    expect(reimportedMapJson(mapOf({ a: { id: 'a', statblockPath: NOTE, hp: { current: 5, max: 15 } } }), plan)).toBeNull();
    expect(reimportedMapJson(mapOf({ a: { id: 'a', hp: { current: 20, max: 27 } } }), plan)).toBeNull();
    expect(reimportedMapJson('not json', plan)).toBeNull();
  });

  it('points tokens that use the old image at the new one', () => {
    const json = mapOf({
      a: { id: 'a', imagePath: 'assets/old.png', statblockPath: NOTE },
      b: { id: 'b', imagePath: 'assets/other.png' },
    });
    const tokens = tokensOf(reimportedMapJson(json, { ...plan, oldImage: 'assets/old.png', newImage: 'assets/new.png' }));
    expect(tokens.a?.imagePath).toBe('assets/new.png');
    expect(tokens.b?.imagePath).toBe('assets/other.png');
  });

  it('leaves the art of tokens of another note alone, even when they share the old image', () => {
    const json = mapOf({
      mine: { id: 'mine', imagePath: 'assets/old.png', statblockPath: NOTE },
      theirs: { id: 'theirs', imagePath: 'assets/old.png', statblockPath: 'elsewhere.md' },
      loose: { id: 'loose', imagePath: 'assets/old.png' },
    });
    const swap = { ...plan, oldImage: 'assets/old.png', newImage: 'assets/new.png' };
    const tokens = tokensOf(reimportedMapJson(json, swap));
    expect(tokens.mine?.imagePath).toBe('assets/new.png');
    expect(tokens.theirs?.imagePath).toBe('assets/old.png');
    expect(tokens.loose?.imagePath).toBe('assets/old.png');
    expect(placedTokenChanges({ statblockPath: 'elsewhere.md', imagePath: 'assets/old.png' }, swap)).toBeNull();
  });

  it('skips a map file the normal loader refuses: one from a newer Atlas, one with no state', () => {
    const tokens = { a: { id: 'a', statblockPath: NOTE, hp: { current: 20, max: 27 } } };
    expect(reimportedMapJson(mapOf(tokens, 99), plan)).toBeNull();
    expect(reimportedMapJson(JSON.stringify({ version: 4 }), plan)).toBeNull();
    expect(reimportedMapJson('[]', plan)).toBeNull();
  });

  it('writes the file the way a normal save does: one line, the file\'s own token fields, nothing else touched', () => {
    const file = { version: 4, state: { mapPath: 'm.atlasmap', objects: { tokens: { a: { id: 'a', statblockPath: NOTE, hp: { current: 20, max: 27 } } }, fog: {} }, camera: { x: 1 } } };
    const written = reimportedMapJson(JSON.stringify(file, null, 4), plan);
    expect(written).toBe(JSON.stringify({
      version: 4,
      state: { mapPath: 'm.atlasmap', objects: { tokens: { a: { id: 'a', statblockPath: NOTE, hp: { current: 15, max: 15 } } }, fog: {} }, camera: { x: 1 } },
    }));
  });
});
