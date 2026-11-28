/**
 * Which fields of a character note are resources (P3c decision 15): only those keep their current
 * value across a re-import. A field is one when the template tracks it or a counting resource of
 * the collection reads it (`resourceOfField`, the way recovery finds a resource), or when the
 * template means it as its hit points. Pure.
 */

import { readsTemplateField, resourceOfField } from '../resources/trackedResources';
import type { ResourceDefinition } from '../resources/resourceTypes';
import type { FieldMeanings } from '../statblocks/resolve/fieldMeanings';
import type { StatblockTemplate } from '../statblocks/model/templateTypes';

/** The test for a note's field key; `template` is null where the note has none Atlas reads (the collection's resources then decide). */
export function isResourceFieldOf(
  template: StatblockTemplate | null,
  resources: readonly ResourceDefinition[],
  meanings: FieldMeanings,
): (key: string) => boolean {
  const hitPoints = meanings['hit-points'];
  if (template) {
    const resourceOf = resourceOfField(template, resources);
    return (key) => key === hitPoints || resourceOf(key) !== undefined;
  }
  const counting = resources.filter((resource) => resource.direction !== 'static');
  return (key) => key === hitPoints || counting.some((resource) => readsTemplateField(resource, key));
}
