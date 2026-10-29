# Deploying the relay

This guide puts the relay and the player page on one small Ubuntu 24.04 server, behind a Cloudflare Tunnel (the
recipe used for the fork) or behind a generic reverse proxy. Hostnames below are placeholders: `play.example.com`
stands for the real one, which lives outside the repository together with IP addresses and tunnel ids.

The relay is one Node process (`node apps/relay/src/main.ts`, Node >= 22.18, TypeScript runs natively). It serves
the player page (`STATIC_DIR`), the HTTP API and the WebSockets on `127.0.0.1:8787`; a proxy in front of it speaks
TLS. Environment variables are listed in `apps/relay/README.md`.

## 1. Build the bundle (on your computer)

```sh
npm ci
npm run bundle:relay
```

This builds `apps/play`, then writes `dist/relay-bundle/` and `dist/relay-bundle.tgz` (`dist/` is git-ignored). The
bundle holds `apps/relay/src/**`, `apps/relay/package.json`, exactly the protocol files the relay imports (found
from the import graph; the build fails if the relay imports anything else), `apps/play/dist/**`, a root
`package.json` and `package-lock.json` (only `ws`, pinned) and a `VERSION` file with the git commit.

`node scripts/bundle-relay.mjs --play-dist <dir> --out <dir>` builds from an existing player build into another
folder (used by the tests).

## 2. Checklist for any proxy

Whatever sits in front of the relay must do all of these. Check each one with the probe (section 7).

1. **WebSocket upgrade.** `Upgrade` and `Connection` headers pass through to `/api/tables/<code>/socket`.
2. **Client address.** The proxy sets one header the relay trusts, and `TRUST_PROXY` names it: `cf` for
   Cloudflare (`CF-Connecting-IP`), `xff` for exactly one proxy that appends to `X-Forwarded-For`, `none`
   otherwise. With `none` behind a proxy every client shares one set of rate limits. The relay must be reachable
   only through the proxy (it listens on `127.0.0.1`).
3. **Request bodies of at least 9 MiB.** Image parts are 8 MiB. Nginx needs `client_max_body_size 9m;` or more;
   Cloudflare's limit (100 MB on the free plan) is enough.
4. **WebSocket frames of 512 KiB.** The GM sends frames up to 320 KiB plus envelope; the relay accepts 512 KiB.
   Do not set a smaller proxy limit.
5. **TLS renewal.** With Cloudflare the edge certificate is Cloudflare's and renews itself; nothing to do on the
   server. With Caddy it renews itself; with nginx use certbot and check its timer.
6. **Restart both together.** After changing the proxy or the relay, restart both and run the probe: a stale proxy
   process may still hold old upstream connections.
7. **A phone on mobile data.** Open the player link on a phone with Wi-Fi off, join, and watch a map load. Carrier
   networks are where idle timeouts and middleboxes show up.

The relay sets its own HTTP limits (not configurable): 20 s for request headers, 300 s per request (an 8 MiB part upload fits down to about 28 KB/s), 95 s keep-alive (above cloudflared's 90 s idle), and at most 512 open connections, WebSockets included. WebSockets are not cut by the request timeouts. After an uncaught error the relay logs one line (error name and code, never the message) and exits with code 1; the unit's `Restart=on-failure` brings it back in 3 s.

## 3. Prepare the server

```sh
# Node 22 from NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version          # v22.18 or newer

sudo useradd --system --home /var/lib/atlas-relay --shell /usr/sbin/nologin atlas-relay
sudo install -d -o atlas-relay -g atlas-relay -m 0750 /var/lib/atlas-relay
sudo install -d -m 0755 /opt/atlas-relay/releases
```

Create `/etc/atlas-relay.env` from `apps/relay/deploy/relay.env.example`, owned by root, mode 0600:

```sh
sudo install -m 0600 -o root -g root relay.env.example /etc/atlas-relay.env
sudoedit /etc/atlas-relay.env       # HOST_KEY=$(openssl rand -base64 32), PUBLIC_ORIGIN=https://play.example.com
```

`PUBLIC_ORIGIN` must match what players open (scheme, `www.`, port), or player sockets are closed with 4017. Put
the same host key into the Atlas plugin's online settings. Install the unit from
`apps/relay/deploy/atlas-relay.service` into `/etc/systemd/system/`.

## 4. Install a release

```sh
COMMIT=$(tar -xzOf relay-bundle.tgz ./VERSION)
sudo mkdir -p /opt/atlas-relay/releases/$COMMIT
sudo tar --no-same-owner -xzf relay-bundle.tgz -C /opt/atlas-relay/releases/$COMMIT
cd /opt/atlas-relay/releases/$COMMIT && sudo npm ci --omit=dev
sudo ln -sfn /opt/atlas-relay/releases/$COMMIT /opt/atlas-relay/current
sudo systemctl daemon-reload && sudo systemctl enable --now atlas-relay
journalctl -u atlas-relay -n 20 --no-pager
curl -sI http://127.0.0.1:8787/ | head -5
```

The relay logs request lines and close codes only, never keys, tickets or table secrets.

## 5. Publish it

### Cloudflare Tunnel (Hetzner + Cloudflare)

Use the tunnel `cloudflared` already runs on the server; do not touch other routes.

Locally managed config (`/etc/cloudflared/config.yml`): add an ingress entry **above** the catch-all rule.

```yaml
ingress:
  # ...existing entries...
  - hostname: play.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404      # the catch-all stays last
```

```sh
cloudflared tunnel ingress validate
cloudflared tunnel route dns <tunnel> play.example.com
sudo systemctl restart cloudflared
```

Dashboard-managed tunnel: Cloudflare Zero Trust -> Networks -> Tunnels -> your tunnel -> Public Hostname -> Add:
hostname `play.example.com`, service type HTTP, URL `127.0.0.1:8787`. The DNS record is created for you.

In the Cloudflare dashboard for the zone, make sure **Network -> WebSockets** is on (it is by default). Set
`TRUST_PROXY=cf`: Cloudflare adds `CF-Connecting-IP`, and the relay listens only on `127.0.0.1`, so nothing but
the tunnel can reach it.

### Generic reverse proxy

Caddy (TLS and WebSocket upgrades work out of the box):

```
play.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Set `TRUST_PROXY=xff`. Nginx needs the upgrade headers and a larger body limit:

```
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 16m;
    proxy_read_timeout 120s;
}
```

(`$remote_addr`, not `$proxy_add_x_forwarded_for`, so a client cannot prepend an address.) Open only 80/443 on the
firewall.

## 6. Update and roll back

Updating keeps the old release on disk, so rolling back is a symlink switch. Tables survive a restart (they are in
the state file); connected sockets reconnect by themselves.

```sh
# update: unpack the new bundle as in section 4, then
sudo ln -sfn /opt/atlas-relay/releases/<new-commit> /opt/atlas-relay/current
sudo systemctl restart atlas-relay
# roll back
sudo ln -sfn /opt/atlas-relay/releases/<old-commit> /opt/atlas-relay/current
sudo systemctl restart atlas-relay
```

Run the probe after each switch. Remove old releases by hand once you are sure (`ls -t /opt/atlas-relay/releases`).

## 7. Probe

From your computer (the host key comes from the environment, never an argument; the probe prints no key, table
secret, ticket or player link):

```sh
HOST_KEY=... npm run probe:relay -- https://play.example.com
```

`probe:relay` refuses a plain `http:` address that is not loopback (`localhost`, `[::1]`, `127.x.x.x`) unless `--insecure` is given, because the host key would travel in clear text.

It creates a table, joins one player (sending the `Origin` a browser would), sends a 320 KiB GM frame and checks it
arrives whole, waits 110 s and checks both sockets are still open, uploads one 8 MiB part and completes it, and
ends the table. One line per check, `PASS` or `FAIL`; the exit code is 0 only if all pass. `--quick` skips the
110 s wait (use it for a local relay).

## 8. State and backup

`STATE_PATH` (`/var/lib/atlas-relay/relay-state.json`) holds the tables, hashed secrets and the ticket signing key.
It is written with mode 0600; keep it that way in any copy. Without it every table and every issued ticket is lost.
Back it up while the relay is running (it is replaced atomically, so a plain copy is consistent):

```sh
sudo install -m 0600 /var/lib/atlas-relay/relay-state.json /root/relay-state.$(date +%F).json
```

Uploaded images (`ASSET_DIR`) are cache for running tables and need no backup.

## Results

Filled in after each real deployment.

| Date | Node | Bundle commit | Probe lines |
| --- | --- | --- | --- |
| 2026-10-29 | 22.23.1 (NodeSource) | cfaeda21 | Not run yet. Local `curl` of the relay and `https://<hostname>/` through the tunnel both answer 200 with the CSP and `no-cache`. |
