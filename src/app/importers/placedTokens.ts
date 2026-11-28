/**
 * Placed tokens of a re-imported character (P3c decisions 15 and 31): a token linked to the note
 * keeps its current resource values, clamped to the new maxima (`syncedResources`), and its
 * conditions as they are; a token whose art is the old portrait takes the new one. Pure: what to
 * change in one token, and the same for the text of a closed map's file.
 */

import { syncedResources } from '../resources/statblockResourceSync';
import { sceneFromFile, sceneToFile } from '../resources/resourceFileFormat';
import type { ResourceDefinition, ResourceHolder, ResourceValue } from '../resources/resourceTypes';
import { NO_MEANINGS, type FieldMeanings } from '../statblocks/resolve/fieldMeanings';
import { normalizeImagePath } from '../utils/pathUtils';
import { parseSceneFile, type LoadableMapEnvelope } from '../services/MapPersistence';

export interface PlacedTokenPlan {
  notePath: string;
  /** The note's fields after the re-import, as the resolver reads them. */
  record: Readonly<Record<string, unknown>>;
  meanings?: FieldMeanings;
  definitions: readonly ResourceDefinition[];
  /** The portrait the tokens used and the one that replaces it; null for none. */
  oldImage: string | null;
  newImage: string | null;
}

export interface PlacedTokenChanges {
  resources?: Record<string, ResourceValue>;
  imagePath?: string;
}

interface PlacedToken extends ResourceHolder {
  statblockPath?: string | undefined;
  imagePath?: string | undefined;
}

const sameImage = (a: string | undefined, b: string | null): boolean => a !== undefined && b !== null && normalizeImagePath(a) === normalizeImagePath(b);

/** What the re-import changes in one token, in memory; null when nothing. */
export function placedTokenChanges(token: PlacedToken, plan: PlacedTokenPlan): PlacedTokenChanges | null {
  const changes: PlacedTokenChanges = {};
  // Only this note's tokens: another note's token may share the portrait file.
  if (token.statblockPath !== plan.notePath) return null;
  const resources = syncedResources(token, plan.record, plan.definitions, plan.meanings ?? NO_MEANINGS);
  if (JSON.stringify(resources) !== JSON.stringify(token.resources ?? {})) changes.resources = resources;
  if (plan.newImage !== null && sameImage(token.imagePath, plan.oldImage)) changes.imagePath = plan.newImage;
  return Object.keys(changes).length > 0 ? changes : null;
}

/** The text of a map's file with its tokens changed; null when the loader refuses the file or no token changes. */
export function reimportedMapJson(content: string, plan: PlacedTokenPlan): string | null {
  let envelope: LoadableMapEnvelope;
  try {
    envelope = parseSceneFile(content);
  } catch {
    return null;
  }
  // The scene as a loaded map holds it, written back as a normal save writes it (`createAtlasStorage`).
  const state = sceneFromFile(envelope.state);
  // The same token objects, seen as far as a re-import reads them.
  const tokens: Record<string, PlacedToken> | undefined = state.objects?.tokens;
  if (!tokens) return null;
  let modified = false;
  for (const [id, token] of Object.entries<PlacedToken>(tokens)) {
    const changes = placedTokenChanges(token, plan);
    if (!changes) continue;
    tokens[id] = { ...token, ...changes };
    modified = true;
  }
  return modified ? JSON.stringify({ ...envelope, state: sceneToFile(state) }) : null;
}
