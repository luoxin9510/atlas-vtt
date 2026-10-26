import { afterEach, beforeEach } from 'vitest';
import { setServerOrigin, UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';

/** Points the online code at Atlas's own server for each test of the file, and at none after it. */
export function useUpstreamServer(): void {
  beforeEach(() => setServerOrigin(UPSTREAM_RELAY_ORIGIN));
  afterEach(() => setServerOrigin(null));
}
