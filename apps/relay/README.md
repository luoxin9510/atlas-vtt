# Atlas fork relay

Self-hosted relay for online play in the Atlas VTT fork. This workspace is
fork-owned (see `docs/fork/FORK_GUIDE.md`).

- Requires Node >= 22.18 (runs TypeScript natively, no build step).
- `npm run relay` starts it; `npm run check:relay` type checks it.

## How to run

```sh
HOST_KEY="$(openssl rand -base64 32)" PUBLIC_ORIGIN=https://play.example.com npm run relay
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
must pass WebSocket upgrades.

- Bind the relay to `127.0.0.1` (the default `HOST`) or firewall its port, so that
  only the proxy can reach it. A client that reaches the relay directly can put
  any address into `X-Forwarded-For` or `CF-Connecting-IP`.
- Use `TRUST_PROXY=cf` only when the relay is behind Cloudflare and nothing else.
- With `TRUST_PROXY=none` behind a proxy every client appears as the proxy's
  address and shares one set of rate limits. Five wrong host keys then lock the GM
  out of `POST /api/tables` for 10 minutes (tables that are already running are
  not affected), and the limit of new players per address is shared by everyone.

## Limits that keep one bad connection from hurting the rest

These are fixed in the code (`apps/relay/src/routing.ts`, `socket.ts`, `http.ts`); only the ping interval is part of the configuration (`RelayConfig.timing.pingIntervalMs`, 30 s by default).

- **A socket that stops reading is dropped.** Everything the relay sends is checked against the socket's unsent bytes. A player past 8 MiB, or a GM past 32 MiB, is closed with code 1013 ("try again later") and its connection is cut a second later. The page reconnects and resyncs; nobody else is held up. The GM has the larger allowance because every player's messages go to it.
- **Dead connections are removed.** Every 30 s the relay sends each socket a WebSocket ping. A socket that has sent nothing (no frame, no pong) since the previous ping is terminated, so a phone that dropped off the network leaves the roster, its seat and its address slot within about a minute. Browsers and Obsidian answer pings by themselves.
- **Refused upgrades free their connection.** A 404 or 429 to a socket request is followed by closing the TCP connection (at the latest 2 s later), and an upgrade that does not finish in 10 s is cut. Without this a client that never closed its side could use up file descriptors.
- **Bodies are small.** Only `POST /api/tables` reads a body, at most 4 KiB. `/api/reports`, `/api/feedback` and every other answer to a request that may carry a body send `Connection: close`, so a client that keeps streaming is cut off.
- **A player page on the wrong Origin** is closed with 4017 (final: the page stops instead of retrying) and the relay logs `player origin refused`. Check `PUBLIC_ORIGIN` (scheme, `www.`, port).
