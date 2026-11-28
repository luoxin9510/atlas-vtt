/**
 * Placed tokens of a re-imported character (P3c decisions 15 and 31): a token linked to the note
 * keeps its current resource values, clamped to the new maxima (`syncedResources`), and its
 * conditions as they are; a token whose art is the old portrait takes the new one. Pure: what to
 * change in one token, and the same for the text of a closed map's file.
 */

import { syncedResources } from '../resources/statblockResourceSync';
import { tokenFromFile, tokenToFile } from '../resources/resourceFileFormat';
import type { ResourceDefinition, ResourceHolder, ResourceValue } from '../resources/resourceTypes';
import { NO_MEANINGS, type FieldMeanings } from '../statblocks/resolve/fieldMeanings';
import { normalizeImagePath } from '../utils/pathUtils';
import { isPersistedMapEnvelope } from '../services/MapPersistence';

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
  if (token.statblockPath === plan.notePath) {
    const resources = syncedResources(token, plan.record, plan.definitions, plan.meanings ?? NO_MEANINGS);
    if (JSON.stringify(resources) !== JSON.stringify(token.resources ?? {})) changes.resources = resources;
  }
  if (plan.newImage !== null && sameImage(token.imagePath, plan.oldImage)) changes.imagePath = plan.newImage;
  return Object.keys(changes).length > 0 ? changes : null;
}

/** The text of a map's file with its tokens changed; null when the file is no map or no token changes. */
export function reimportedMapJson(content: string, plan: PlacedTokenPlan): string | null {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  const tokens = isPersistedMapEnvelope(data) ? data.state?.objects?.tokens : undefined;
  if (!tokens) return null;
  let modified = false;
  for (const [id, stored] of Object.entries<object>(tokens)) {
    const token = tokenFromFile(stored) as PlacedToken;
    const changes = placedTokenChanges(token, plan);
    if (!changes) continue;
    (tokens as Record<string, object>)[id] = tokenToFile({ ...token, ...changes });
    modified = true;
  }
  return modified ? JSON.stringify(data, null, 2) : null;
}
