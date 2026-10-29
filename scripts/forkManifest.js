/**
 * The manifest a local install carries. The community store would "update" a plugin installed as
 * `atlas-vtt` to the official release, so local installs get their own id. The repository's
 * manifest.json is never changed.
 */
function forkManifest(manifest) {
  return {
    ...manifest,
    id: 'atlas-vtt-fork',
    name: 'Atlas VTT (fork)',
    version: `${manifest.version}-fork`,
    description: `${manifest.description} Self-hosted online fork (luoxin9510/atlas-vtt).`,
  };
}

module.exports = { forkManifest };
