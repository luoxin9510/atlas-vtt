import type { SharedEffect, SharedLightingScene, SharedSight, SharedVision } from '../../../../src/app/online/protocol/index.ts';
import { CONDITION_EFFECTS } from '../../../../src/app/online/protocol/index.ts';
import { parseSenseDefinitions } from '../../../../src/app/gameSystems/senseValidation';
import type { ConditionDefinition } from '../../../../src/app/types/collectionSettingsTypes';
import type { SenseDefinition } from '../../../../src/app/types/senseTypes';
import type { SightRules, TokenSight } from '../../../../src/app/vision/sightRules';
import { BLIND_TOKEN } from './lightingInputs.ts';
import { sameValue } from './sameValue.ts';

/** One synthetic condition per effect: tokens carry the effect ids as their conditions (`LightingInputs`). */
const CONDITIONS: readonly ConditionDefinition[] = CONDITION_EFFECTS.map((effect: SharedEffect): ConditionDefinition => ({ id: effect, name: effect, color: '#000000', effect }));

/** A token that is not known (or still pending) sees and senses nothing: the same fail-closed answer a statblock still being read gives. */
const UNKNOWN: TokenSight = { senses: [], pending: true };

interface Cached {
  readonly visions: ReadonlyMap<string, SharedVision>;
  readonly rules: SightRules;
}

const definitionsOf = new WeakMap<SharedLightingScene, readonly SenseDefinition[]>();
const last = new WeakMap<SharedLightingScene, Cached>();

function sensesOf(lighting: SharedLightingScene): readonly SenseDefinition[] {
  let definitions = definitionsOf.get(lighting);
  if (!definitions) {
    definitions = parseSenseDefinitions(lighting.senses) ?? [];
    definitionsOf.set(lighting, definitions);
  }
  return definitions;
}

function sameVisions(a: ReadonlyMap<string, SharedVision>, b: ReadonlyMap<string, SharedVision>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, vision] of a) {
    const other = b.get(id);
    if (other === undefined || !sameValue(vision, other)) return false;
  }
  return true;
}

/**
 * What the GM's collection decides about sight, from the messages: its senses, the four conditions
 * that change sight (as synthetic conditions named by their effect) and how each vision token
 * perceives, as the GM worked it out. The same object while none of that changed, since sight
 * compares its rules by reference.
 */
export function sightRulesOf(lighting: SharedLightingScene, sight: SharedSight): SightRules {
  const visions = new Map<string, SharedVision>();
  for (const token of sight.blind === true ? [...sight.tokens, BLIND_TOKEN] : sight.tokens) if (token.vision) visions.set(token.id, token.vision);
  const previous = last.get(lighting);
  if (previous && sameVisions(previous.visions, visions)) return previous.rules;
  const rules: SightRules = {
    definitions: sensesOf(lighting),
    conditions: CONDITIONS,
    visionOf: (token): TokenSight => {
      const vision = visions.get(token.id);
      if (vision === undefined || vision.pending === true) return UNKNOWN;
      return { senses: vision.senses, ...(vision.sightRange !== undefined && { sightRange: vision.sightRange }) };
    },
  };
  last.set(lighting, { visions, rules });
  return rules;
}
