import { describe, expect, it } from 'vitest';
import { reimportedMapJson } from '../../../src/app/importers/placedTokens';
import { HP, STR } from '../../mocks/resourceFixtures';

const NOTE = 'atlas-vtt/collections/crew/characters/Robin.md';

const mapOf = (tokens: Record<string, object>): string => JSON.stringify({ version: 4, state: { objects: { tokens } } });
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
});
