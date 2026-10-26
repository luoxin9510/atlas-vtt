# Atlas fork relay

Self-hosted relay for online play in the Atlas VTT fork. This workspace is
fork-owned (see `docs/fork/FORK_GUIDE.md`).

- Requires Node >= 22.18 (runs TypeScript natively, no build step).
- `npm run relay` starts it; `npm run check:relay` type checks it.
- `src/main.ts` is currently a placeholder that exits 0.
- With `TRUST_PROXY=xff` the relay must sit directly behind the one proxy that appends `X-Forwarded-For` (the last entry is used).
