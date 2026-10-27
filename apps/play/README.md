# Atlas fork player app

The browser app players open from a join link of the self-hosted relay (`apps/relay`).
It imports only the `shared` and `play` groups of `scripts/boundaries.mjs`.

```sh
npm run dev:play        # dev server; /api is proxied to PLAY_RELAY (default http://127.0.0.1:8787)
npm run build:play      # apps/play/dist, served by the relay as STATIC_DIR
npm run check:play      # type check
npx vitest run --project unit tests/unit/play   # unit tests, incl. the GM-relay-player end-to-end test
npm run test:play-e2e   # builds the app, then drives it in Chromium under the relay's CSP
```

## Development

Run the relay with the dev server's address as its public origin, then the dev server:

```sh
HOST_KEY=dev-host-key-0123456789abcdef PUBLIC_ORIGIN=http://localhost:5173 npm run relay
npm run dev:play
```

Set the plugin's server address to the relay (`http://127.0.0.1:8787`), start a table and open
the join link with the dev server's origin (`http://localhost:5173/#<table code>`).

## Production

`npm run build:play`, then start the relay with `STATIC_DIR=apps/play/dist` and
`PUBLIC_ORIGIN` set to the address players use. The relay answers the page with a strict
Content-Security-Policy (no inline scripts; Pixi runs without `eval` through `pixi.js/unsafe-eval`).

## What M3 covers

Join by table link and code (or a saved seat), the unlit map with tokens, grid, fog, pins and
annotations, pan and zoom by touch or mouse, the table log and chat, the dice tray with roll modes,
the initiative list, the players list, the "your turn" banner, Chinese by default with English
selectable, a low-power mode and the AGPL source and licence links.

Not yet: a scene with dynamic lighting shows a placeholder ("this scene needs dynamic lighting")
until Plan 2b; the app never requests its map and draws none of its tokens, fog or layers (fail
closed). Moving own tokens (`drag-token`) is recognised but does nothing until Plan 2b. Lighting,
sight, explored memory, doors, sensed tokens, live marks, widgets, shown images and books are
ignored. A stretched map is drawn unstretched (the stretch is not shared).
