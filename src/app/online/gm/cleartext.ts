/** Whether a host name is this machine: `localhost`, any `127.x.x.x` address or `[::1]`. */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * Whether an origin is plain `http:` to a machine other than this one, where the host key would
 * travel in clear text. Text that is no address is not cleartext.
 */
export function isCleartextRemote(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return url.protocol === 'http:' && !isLoopbackHost(url.hostname);
}
