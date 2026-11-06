# 0001 — Socket first, binary as fallback

## Status

Superseded by [0002](0002-mod-sandbox-cli-transport.md).

## Context

Herdr accepts agent state two ways: the local socket (`HERDR_SOCKET_PATH`,
newline-delimited JSON) and the CLI binary (`HERDR_BIN_PATH pane report-agent`).
Herdr's own socket documentation recommends the CLI to plugins and reserves the
raw socket for clients that need request/response control, mainly because the
socket is a Unix domain socket on Unix and a named pipe on Windows.

The predecessor of this Mod was a hook script that forked a Node process per
event and then spawned the binary: two process starts per tool call.

## Decision

Try the socket first for every report, on a connection of its own. Herdr 0.9.5
closes the connection once it has sent the response (only `events.subscribe`
keeps one open), so a cached connection buys nothing but a write into a dead
socket and a 2 s wait before the fallback. On a failed request (refused, closed,
or 2 s without a reply) send that report through the binary. The fallback is not
sticky: the next report tries the socket again.

## Consequences

- The common path costs a connect, a write and a close: no fork, no spawn.
- We own platform differences and request timeouts that the CLI would otherwise
  handle. Confined to `plugin/hooks/herdr.ts`.
- A project that only ever sets `HERDR_BIN_PATH` keeps working unchanged: the
  socket branch is skipped when the variable is absent.
- Observed on Herdr 0.9.5: `pane.report_agent` requires the request `id` to be a
  string, and it answers `{"result":{"type":"ok"}}` before the connection
  closes.
