# Atlas fork relay

Self-hosted relay for online play in the Atlas VTT fork. This workspace is
fork-owned (see `docs/fork/FORK_GUIDE.md`).

- Requires Node >= 22.18 (runs TypeScript natively, no build step).
- `npm run relay` starts it; `npm run check:relay` type checks it.

## How to run

```sh
HOST_KEY='a long random secret' PUBLIC_ORIGIN=https://play.example.com npm run relay
```

Configuration is by environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST_KEY` | none, required | The GM's host key (at least 24 characters). The plugin sends it as `Authorization: Bearer <host key>` when it creates a table. |
| `PUBLIC_ORIGIN` | none, required | The origin players open, such as `https://play.example.com` (no path). Player sockets and `POST /api/tables` must come from it. |
| `HOST` | `127.0.0.1` | The address to listen on. |
| `PORT` | `8787` | The port to listen on (0-65535). |
| `MAX_PLAYERS` | `8` | Seats per table, 1-12. |
| `STATE_PATH` | `./relay-state.json` | Where tables are kept across restarts. |
| `STATIC_DIR` | none | A folder of static files (the player page) to serve. |
| `TRUST_PROXY` | `none` | `none`, `xff` or `cf`: where the client address comes from. |

In the Atlas plugin's online settings, set the server address to the relay's
public origin and keep the host key.

## Behind a reverse proxy

Set `PUBLIC_ORIGIN` to the public `https` origin the proxy serves. Use
`TRUST_PROXY=xff` only with exactly one proxy in front, directly in front of the
relay, that appends to `X-Forwarded-For` (the last entry is the client). The proxy
must pass WebSocket upgrades. With `TRUST_PROXY=none` every client appears as the
proxy's address and shares one set of rate limits.
