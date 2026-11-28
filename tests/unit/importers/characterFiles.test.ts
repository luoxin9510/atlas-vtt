import { describe, expect, it } from 'vitest';
import { acceptOf, findOrAskSource, pickCharacterFiles, readCharacterSource, type CharacterFileHost } from '../../../src/app/importers/characterFiles';

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

class FakeInput {
  attr: Record<string, string> = {};
  files: File[] | null = null;
  removed = false;
  private listeners = new Map<string, () => void>();
  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, listener); }
  remove(): void { this.removed = true; }
  click(): void { /* the test fires change or cancel */ }
  fire(type: string): void { this.listeners.get(type)?.(); }
}

/** Just enough of a document: the input it creates, which the test then drives. */
function fakeDocument(): { doc: Document; input: FakeInput } {
  const input = new FakeInput();
  const doc = { body: { createEl: (_tag: string, options: { attr?: Record<string, string> }) => { input.attr = options.attr ?? {}; return input; } } };
  return { doc: doc as unknown as Document, input };
}

const fileOf = (name: string, text: string): File => ({ name, arrayBuffer: () => Promise.resolve(bytesOf(text)) }) as unknown as File;

const host = (overrides: Partial<CharacterFileHost> = {}): CharacterFileHost => ({
  pathOf: (file) => `/chars/${file.name}`,
  read: () => Promise.resolve(bytesOf('disk')),
  ...overrides,
});

const text = (buffer: ArrayBuffer): string => new TextDecoder().decode(buffer);
const tick = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('accept string', () => {
  it('lists the extensions with a dot, lower case, once each', () => {
    expect(acceptOf(['gcs', '.JSON', 'gcs'])).toBe('.gcs,.json');
  });
});

describe('pickCharacterFiles', () => {
  it('opens a multiple input with the accept string and maps the files to path, name and bytes', async () => {
    const { doc, input } = fakeDocument();
    const picked = pickCharacterFiles(doc, ['gcs'], host());
    expect(input.attr.accept).toBe('.gcs');
    expect(input.attr.multiple).toBeDefined();
    input.files = [fileOf('Robin.gcs', 'robin'), fileOf('Ann.gcs', 'ann')];
    input.fire('change');
    const files = await picked;
    expect(files.map((f) => [f.path, f.fileName, text(f.bytes)])).toEqual([['/chars/Robin.gcs', 'Robin.gcs', 'robin'], ['/chars/Ann.gcs', 'Ann.gcs', 'ann']]);
    expect(input.removed).toBe(true);
  });

  it('gives a null path where the host cannot say', async () => {
    const { doc, input } = fakeDocument();
    const picked = pickCharacterFiles(doc, ['gcs'], host({ pathOf: () => null }));
    input.files = [fileOf('Robin.gcs', 'robin')];
    input.fire('change');
    expect((await picked)[0]?.path).toBeNull();
  });

  it('resolves to nothing on cancel, and on a change with no files', async () => {
    const first = fakeDocument();
    const cancelled = pickCharacterFiles(first.doc, ['gcs'], host());
    first.input.fire('cancel');
    expect(await cancelled).toEqual([]);
    expect(first.input.removed).toBe(true);
    const second = fakeDocument();
    const empty = pickCharacterFiles(second.doc, ['gcs'], host());
    second.input.files = [];
    second.input.fire('change');
    expect(await empty).toEqual([]);
  });
});

describe('readCharacterSource', () => {
  it('returns the bytes of a readable path', async () => {
    expect(text((await readCharacterSource('/a.gcs', host()))!)).toBe('disk');
  });

  it('returns null for a missing file and for a read that throws, never throwing itself', async () => {
    expect(await readCharacterSource('/a.gcs', host({ read: () => Promise.resolve(null) }))).toBeNull();
    expect(await readCharacterSource('/a.gcs', host({ read: () => Promise.reject(new Error('EACCES')) }))).toBeNull();
    expect(await readCharacterSource('/a.gcs', host({ read: () => { throw new Error('sync'); } }))).toBeNull();
  });
});

describe('readCharacterSource refuses sources that are no local absolute path', () => {
  const reads: string[] = [];
  const spying = host({ read: (path) => { reads.push(path); return Promise.resolve(bytesOf('disk')); } });

  it.each([
    ['a Windows UNC path', '\\\\server\\share\\Robin.gcs'],
    ['a UNC path with forward slashes', '//server/share/Robin.gcs'],
    ['a Windows extended path', '\\\\?\\C:\\Robin.gcs'],
    ['a relative path', 'chars/Robin.gcs'],
    ['a dot path', './Robin.gcs'],
    ['a parent path', '../Robin.gcs'],
    ['a drive-relative path', 'C:Robin.gcs'],
    ['an empty path', ''],
    ['a url', 'https://example.com/Robin.gcs'],
  ])('%s', async (_label, path) => {
    reads.length = 0;
    expect(await readCharacterSource(path, spying)).toBeNull();
    expect(reads).toEqual([]);
  });

  it.each([['a POSIX path', '/Users/me/Robin.gcs'], ['a Windows drive path', 'C:\\Users\\me\\Robin.gcs'], ['a Windows drive path with slashes', 'd:/chars/Robin.gcs']])('reads %s', async (_label, path) => {
    reads.length = 0;
    expect(text((await readCharacterSource(path, spying))!)).toBe('disk');
    expect(reads).toEqual([path]);
  });

  it('asks with the picker when the recorded source is refused', async () => {
    reads.length = 0;
    const { doc, input } = fakeDocument();
    const asked = findOrAskSource({ source: '//evil/share/Robin.gcs' }, doc, ['gcs'], spying);
    await tick();
    input.fire('cancel');
    expect(await asked).toBeNull();
    expect(reads).toEqual([]);
  });
});

describe('findOrAskSource', () => {
  const record = { importer: 'pack:gcs', source: '/chars/Robin.gcs', keys: [] };

  it('uses the recorded path when it can be read, without asking', async () => {
    const { doc, input } = fakeDocument();
    const found = await findOrAskSource(record, doc, ['gcs'], host());
    expect(found && [found.path, found.fileName, text(found.bytes)]).toEqual(['/chars/Robin.gcs', 'Robin.gcs', 'disk']);
    expect(input.attr.accept).toBeUndefined();
  });

  it('asks for a single file when the path cannot be read, and returns the new path', async () => {
    const { doc, input } = fakeDocument();
    const asked = findOrAskSource(record, doc, ['gcs'], host({ read: () => Promise.resolve(null), pathOf: () => '/moved/Robin.gcs' }));
    await tick();
    expect(input.attr.multiple).toBeUndefined();
    input.files = [fileOf('Robin.gcs', 'moved'), fileOf('Other.gcs', 'other')];
    input.fire('change');
    const found = await asked;
    expect(found && [found.path, found.fileName, text(found.bytes)]).toEqual(['/moved/Robin.gcs', 'Robin.gcs', 'moved']);
  });

  it('returns null when the person cancels the picker', async () => {
    const { doc, input } = fakeDocument();
    const asked = findOrAskSource(record, doc, ['gcs'], host({ read: () => Promise.resolve(null) }));
    await tick();
    input.fire('cancel');
    expect(await asked).toBeNull();
  });
});
