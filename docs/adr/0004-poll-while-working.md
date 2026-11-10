# 0004 — Poll the screen while a turn runs

## Status

Accepted, temporary. Supersedes ADR 0003's "no polling" while the engine has
no pre-answer hook.

## Context

In a PTC session the model's `AskUserQuestion` is a nested ask inside the
`REPL` tool: the engine waits in `waitForPtcQuestion` (AskService +
`enqueueSandboxApproval`), and only runs the tool — raising `tool.call` —
once the answer is submitted (`executeNested`). A probe on 2.181.0 confirmed
the blocked report lands after the person answered, so the pane showed
`working` for the whole wait. `ui.render` is no seam either: the dialog is
not a render site the plugin sees (only `ToolUse`/`ToolResult` arrived).

## Decision

While a turn is active, read `herdr pane read --source detection` every 2 s
and run the ADR 0003 rules. A hit reports `blocked`; a miss reports `working` again, so the
question UI's review page had to be added to the rules (it has no `Esc to
cancel`). A `blocked` a hook reported is never cleared by the screen. A failed read disables screen reads for the process, as before.
Polling stops at `turn.complete`, `session.start` and `session.end`.

## Considered options

- **Wait for an engine hook**: the right fix. The PTC ask should announce
  itself before it waits, like `$.ui.ask` raises `tool.call`. Not available
  on 2.181.0; switch to it when it lands and delete the poll.
- **Leave it working**: the pane misreports the one state this mod exists
  for, in the default tool mode.

## Consequences

- One extra herdr read per 2 s per running turn (about 30 a minute), about
  250 ms each, in the background; the turn never waits on it.
- Detection is best-effort: a missed rule leaves the pane `working`. The
  rules stay a one-file diff in `plugin/hooks/detect.ts`.
