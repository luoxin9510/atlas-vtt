import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Root } from 'mdast';
import { t } from '../../../../src/app/i18n/index.ts';
import type { SharedNote } from '../../../../src/app/online/protocol/fork.ts';
import type { Loader } from '../assets/useAssetUrl.ts';
import { NoteMarkdown } from '../notes/NoteMarkdown.tsx';
import { parseCopy } from '../notes/parseCopy.ts';

export interface NotesPanelProps {
  notes: readonly SharedNote[];
  assets: Loader;
}

type Loaded = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; tree: Root };

const byText = (a: string, b: string): number => a.localeCompare(b);

/** Ungrouped notes first, then the groups by name; titles sorted inside each. */
function grouped(notes: readonly SharedNote[]): readonly { group: string | null; notes: readonly SharedNote[] }[] {
  const groups = new Map<string | null, SharedNote[]>();
  for (const note of notes) groups.set(note.group ?? null, [...(groups.get(note.group ?? null) ?? []), note]);
  const names = [...groups.keys()].filter((name): name is string => name !== null).sort(byText);
  return [...(groups.has(null) ? [null] : []), ...names].map((group) => ({ group, notes: groups.get(group)!.sort((a, b) => byText(a.title, b.title)) }));
}

/** The text of a note, fetched whole from the GM and parsed; `retry` asks again after a failure. */
function useNoteTree(note: SharedNote | undefined, assets: Loader): { loaded: Loaded; retry: () => void } {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const hash = note?.text.hash;
  useEffect(() => {
    if (note === undefined) return undefined;
    let cancelled = false;
    setLoaded({ kind: 'loading' });
    assets.load(note.text, null).then((asset) => {
      if (cancelled) return;
      setLoaded(asset === null ? { kind: 'failed' } : { kind: 'ready', tree: parseCopy(new TextDecoder('utf-8').decode(asset.bytes)) });
    }).catch(() => { if (!cancelled) setLoaded({ kind: 'failed' }); });
    return () => { cancelled = true; };
  }, [assets, hash, attempt]);
  return { loaded, retry: () => setAttempt((count) => count + 1) };
}

function NoteView({ note, notes, assets, onOpen, onBack }: { note: SharedNote | undefined; notes: readonly SharedNote[]; assets: Loader; onOpen: (id: string) => void; onBack: () => void }): ReactElement {
  const { loaded, retry } = useNoteTree(note, assets);
  return (
    <div className="atlas-play-notes">
      <button type="button" className="atlas-play-note-back" onClick={onBack}>{t('onlinePlay.notes.back')}</button>
      {note === undefined ? <p className="atlas-play-empty">{t('onlinePlay.notes.gone')}</p> : null}
      {note !== undefined && loaded.kind === 'loading' ? <p className="atlas-play-empty">{t('onlinePlay.notes.loading')}</p> : null}
      {note !== undefined && loaded.kind === 'failed' ? (
        <div role="alert"><p className="atlas-play-empty">{t('onlinePlay.notes.failed')}</p><button type="button" onClick={retry}>{t('onlinePlay.notes.retry')}</button></div>
      ) : null}
      {note !== undefined && loaded.kind === 'ready' ? (
        <>
          <h2 className="atlas-play-note-title">{note.title}</h2>
          <NoteMarkdown tree={loaded.tree} notes={notes} onOpen={onOpen} assets={assets} />
        </>
      ) : null}
    </div>
  );
}

/** The shared notes by group; opening one reads it in place. Loaded lazily, so the Markdown code is a chunk of its own. */
export function NotesPanel({ notes, assets }: NotesPanelProps): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => grouped(notes), [notes]);
  if (openId !== null) {
    return <NoteView key={openId} note={notes.find((note) => note.id === openId)} notes={notes} assets={assets} onOpen={setOpenId} onBack={() => setOpenId(null)} />;
  }
  if (notes.length === 0) return <p className="atlas-play-empty">{t('onlinePlay.notes.empty')}</p>;
  return (
    <div className="atlas-play-notes">
      {groups.map(({ group, notes: inGroup }) => (
        <section key={group ?? ''} className="atlas-play-note-group">
          {group !== null ? <h3>{group}</h3> : null}
          <ul>
            {inGroup.map((note) => <li key={note.id}><button type="button" onClick={() => setOpenId(note.id)}>{note.title}</button></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
