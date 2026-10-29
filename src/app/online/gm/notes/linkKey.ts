import type { SharedInfo } from './sharedNotes.ts';

/** What a note's links lead to, as far as its copy can show it. */
export interface LinkState {
  /** The sorted `shown`, joined: a change reads the note again. Unshared and missing targets give the same copy, so they are not in it. */
  readonly key: string;
  /** `${id}:${title}` of each shared target: the titles a copy may carry. */
  readonly shown: ReadonlySet<string>;
}

/** The shared targets among a note's resolved links. */
export function linkState(links: Readonly<Record<string, number>>, info: (path: string) => SharedInfo | undefined): LinkState {
  const shown = new Set<string>();
  for (const target of Object.keys(links)) {
    const one = info(target);
    if (one !== undefined) shown.add(`${one.id}:${one.title}`);
  }
  return { key: [...shown].sort().join('\n'), shown };
}
