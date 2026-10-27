# Atlas fork player app

The browser app players open from a join link of the self-hosted relay (`apps/relay`).
It imports only the `shared` and `play` groups of `scripts/boundaries.mjs`.

```sh
npm run dev:play     # dev server; /api is proxied to PLAY_RELAY (default http://127.0.0.1:8787)
npm run build:play   # apps/play/dist, served by the relay as STATIC_DIR
npm run check:play   # type check
```
