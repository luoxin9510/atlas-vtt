import type { Point } from '../../../../src/app/grid/hexGeometry.ts';
import type { LivePlace } from '../../../../src/app/online/protocol/live.ts';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';

/**
 * The live places after `places` arrived: the latest of each token wins and `end` removes it. Places of
 * tokens not in `listed` are dropped. Returns `live` itself when nothing changed.
 */
export function reduceLive(live: ReadonlyMap<string, Point>, places: readonly LivePlace[], listed: readonly Pick<SharedToken, 'id'>[]): ReadonlyMap<string, Point> {
  const ids = new Set(listed.map((token) => token.id));
  let next: Map<string, Point> | null = null;
  const edit = (): Map<string, Point> => (next ??= new Map(live));
  for (const id of live.keys()) if (!ids.has(id)) edit().delete(id);
  for (const place of places) {
    if (place.end === true) {
      if ((next ?? live).has(place.id)) edit().delete(place.id);
    } else if (ids.has(place.id)) {
      edit().set(place.id, { x: place.x, y: place.y });
    }
  }
  return next ?? live;
}

/**
 * Where tokens are drawn instead of the list's place: those other screens are dragging (`live`), and
 * the one the local drag controls (`set`), which wins over the echoes of the same token.
 */
export class TokenOverrides {
  private readonly previews = new Map<string, Point>();

  set(id: string, at: Point | null): void {
    if (at === null) this.previews.delete(id);
    else this.previews.set(id, at);
  }

  /** The list with the overridden tokens moved; the list itself when none is. */
  apply(tokens: readonly SharedToken[], live: ReadonlyMap<string, Point>): readonly SharedToken[] {
    if (live.size === 0 && this.previews.size === 0) return tokens;
    let changed = false;
    const shown = tokens.map((token) => {
      const at = this.previews.get(token.id) ?? live.get(token.id);
      if (at === undefined || (at.x === token.x && at.y === token.y)) return token;
      changed = true;
      return { ...token, x: at.x, y: at.y };
    });
    return changed ? shown : tokens;
  }
}
