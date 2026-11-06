# 0002 — CLI transport only, inside the Mod sandbox

## Status

Accepted. Supersedes [0001](0001-socket-first-transport.md).

## Context

CodeBuddy Mods run in an isolated VM. Imports outside the plugin directory are
rejected (`Mod import node:child_process is unavailable; use the $ host API`),
and `process` is not exposed at all. That removes both transports 0001 relied
on: `node:net` for the socket and `node:child_process` for the binary.

`$` exposes `$.process.run(argv)` and `$.env.get(name)`. `$.http.fetch` can
target a Unix socket but speaks HTTP, while Herdr's socket speaks
newline-delimited JSON, so it cannot carry these reports either.

## Decision

Build the adapter on first hook use, read `HERDR_ENV`, `HERDR_PANE_ID` and
`HERDR_BIN_PATH` through `$.env.get`, and send every report with
`$.process.run([binary, 'pane', 'report-agent', ...])`. State deduplication and
the clock-seeded `--seq` stay; the in-flight queue goes away because the spawn
is fire-and-forget.

## Consequences

- One herdr process per state change instead of a socket write. Herdr's own
  socket documentation already recommends the CLI to plugins.
- Mods need `HERDR_BIN_PATH`; a socket-only setup no longer reports.
