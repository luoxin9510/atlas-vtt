import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { forkManifest } = require('../../scripts/forkManifest.js');
const manifest = require('../../manifest.json');

describe('forkManifest', () => {
  it('gives the fork its own id, name, version and description', () => {
    const fork = forkManifest({ id: 'atlas-vtt', name: 'Atlas VTT', version: '0.9.1', minAppVersion: '1.8.7', description: 'Maps.', author: 'A' });
    expect(fork).toEqual({
      id: 'atlas-vtt-fork',
      name: 'Atlas VTT (fork)',
      version: '0.9.1-fork',
      minAppVersion: '1.8.7',
      description: 'Maps. Self-hosted online fork (luoxin9510/atlas-vtt).',
      author: 'A',
    });
  });

  it('leaves the repository manifest alone', () => {
    forkManifest(manifest);
    expect(manifest.id).toBe('atlas-vtt');
  });
});
