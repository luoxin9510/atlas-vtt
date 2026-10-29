# Atlas fork relay

Self-hosted relay for online play in the Atlas VTT fork. This workspace is
fork-owned (see `docs/fork/FORK_GUIDE.md`).

- Requires Node >= 22.18 (runs TypeScript natively, no build step).
- `npm run relay` starts it; `npm run check:relay` type checks it.

Deploying it on a server (bundle, systemd unit, Cloudflare Tunnel, probe): `docs/fork/deployment.md`.

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
| `STATIC_DIR` | none | A folder of static files (the player page) to serve: `apps/play/dist` after `npm run build:play`. |
| `ASSET_DIR` | `assets` beside `STATE_PATH` | Where uploaded map and token images are kept (per table; removed when the table ends). A table may store 2 GiB, the server 10 GiB, and uploads stop (507) with less than 2 GiB of free disk. |
| `TRUST_PROXY` | `none` | `none`, `xff` or `cf`: where the client address comes from. |

## Image cache

The GM's plugin puts each map and token image into the relay once, so players download it
over plain HTTP instead of in socket chunks. Images are kept per table under `ASSET_DIR`, are
checked against their SHA-256 and their type (PNG, JPEG, WebP, GIF, AVIF; at most 64 MiB), and are
deleted when the table ends or, after a restart, when no table with that code is left. Routes (all
with the table secret as Bearer): `GET /api/tables/{code}/assets/{sha256}` (which parts are
held), `PUT .../parts/{index}` (8 MiB parts), `POST .../complete` and `POST .../tickets`. Limits: a
table has at most 2 uploads in flight and 4 unfinished images, and may store 2 GiB; the server stores
10 GiB and refuses uploads with `507` below 2 GiB of free disk; part requests are limited to 60 a
minute per client address (`429`); unfinished parts are deleted after 1 hour. The caps are
`RelayConfig` fields (`maxTableAssetBytes`, `maxServerAssetBytes`, `minFreeBytes`), not environment
variables. If the cache refuses, the GM sends the image over the socket as before.

## Image tickets

Players fetch map and token images with `GET /api/assets/{sha256}?t=<ticket>`. The GM's
plugin asks for a ticket with `POST /api/tables/{code}/assets/{sha256}/tickets`
(table secret as Bearer, body `{"player": "<player id>"}`); it is valid for 120 seconds and
is signed (HMAC-SHA-256) with a 32 byte key kept in the state file, so a relay with a new
state file refuses old tickets. Every failure (bad, expired or forged ticket, unknown
image, ended table) gets the same `404`. Minting has its own limit of 600 requests per minute per client address (part uploads: 60). The relay logs the path only, never the query.

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

These are fixed in the code (`apps/relay/src/routing.ts`, `socket.ts`, `http.ts`); the ping interval (`RelayConfig.timing.pingIntervalMs`, 30 s), the stall window and the backlog cap (above) are fields of `RelayConfig`.

- **A socket that stops reading is dropped, one that reads slowly is not.** The relay feeds each socket a little at a time and keeps the rest of what it has to send in memory. A socket is closed with code 1013 ("try again later", not final, so the page reconnects and resyncs) in two cases: no frame has left for it for `timing.stallMs` (30 s), or what is waiting for it passes `maxBacklogBytes` (96 MiB, one largest asset in base64 plus slack). A phone on a slow link that keeps reading therefore receives a 30 MB map completely, however long it takes; a peer that stopped reading is cut after 30 s (its connection is terminated a second after the close). Only that socket is dropped. Both values are fields of `RelayConfig` (`timing.stallMs`, `maxBacklogBytes`), not environment variables. A relay-wide budget (`maxTotalBacklogBytes`, 256 MiB, a broadcast shared by many sockets counted once) closes the socket with the largest backlog 1013 when passed, players before the GM. Only sockets with queued bytes are candidates, and a payload shared by several sockets frees memory only when its last holder lets go, so a load shared by all can close all its holders. A close the relay chooses (kick, end, replace) waits for the socket's queued frames to be handed on, at most 5 s.
- **Dead connections are removed.** Every 30 s the relay sends each socket a WebSocket ping. A socket that has sent nothing (no frame, no pong) since the previous ping is terminated, so a phone that dropped off the network leaves the roster, its seat and its address slot within about a minute. Browsers and Obsidian answer pings by themselves.
- **Refused upgrades free their connection.** A 404 or 429 to a socket request is followed by closing the TCP connection (at the latest 2 s later), and an upgrade that does not finish in 10 s is cut. Without this a client that never closed its side could use up file descriptors.
- **Bodies are small.** Only `POST /api/tables` reads a body, at most 4 KiB (a larger declared length is refused with 413 before the key is looked at, and every refusal closes the connection). `/api/reports`, `/api/feedback` and every other answer to a request that may carry a body send `Connection: close`, so a client that keeps streaming is cut off.
- **A player page on the wrong Origin** is closed with 4017 (final: the page stops instead of retrying) and the relay logs `player origin refused`. Check `PUBLIC_ORIGIN` (scheme, `www.`, port).
