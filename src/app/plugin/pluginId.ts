/** The id Obsidian knows Atlas by when nothing has been set: the upstream plugin id. */
const DEFAULT_ID = 'atlas-vtt';

let current = DEFAULT_ID;

/**
 * Records the id the running plugin loaded under (`manifest.id`), so the plugin registry and command
 * lookups find Atlas when it runs as a fork with another id. An empty id resets to the default.
 */
export function setAtlasPluginId(id: string): void {
  current = id === '' ? DEFAULT_ID : id;
}

/** The id Atlas runs under: the key in `app.plugins.plugins` and the prefix of its command ids. */
export function atlasPluginId(): string {
  return current;
}

/** The id of Atlas's command `name`, as `executeCommandById` takes it. */
export function atlasCommandId(name: string): string {
  return `${current}:${name}`;
}
