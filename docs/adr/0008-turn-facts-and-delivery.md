# 0008 — Track turn facts, not turn events

## Status

Accepted. Extends [0005](0005-prompt-notification.md) and
[0007](0007-turn-answer-not-screen.md); the idle-time screen fallback of
[0003](0003-screen-blocked-detection.md) stays.

## Context

Two live cases showed the pane lying in both directions:

- A PTC session asked a question inside a long REPL cell. The notification
  reported `blocked` correctly; the person answered; the cell kept streaming
  for minutes and the pane stayed `blocked`, because the only exit was the
  tool's `tool.call` settling at the end of that cell.
- A running turn reported `idle` (`done` in the sidebar) while the engine was
  still working. The engine log for that session shows no `idle` transition at
  all, so the turn was active; the adapter had `turnActive === false`.

The cause is structural, not a single bad event:

- `turn.start` / `turn.complete` are **sampled**, not raised: the Mod
  subscription reads `getSnapshot().lastTransition` and only fires when it
  happens to see `RUN_PREPARING → PREPARING` (or a transition to `IDLE`).
  Two transitions close together, or a callback one tick late, drops the event.
- `blocked` had exactly one exit witness (the tool settling). In PTC that
  witness arrives late or not at all.
- `report()` recorded the new state **before** spawning the CLI and swallowed
  failures, so a single dropped report was never retried: every later report of
  the same state was deduped away. Herdr ignores non-increasing `--seq`, so the
  pane stayed on the stale state.

## Decision

The pane state is a function of two facts, never of the event stream:

- `busy` — a turn is running. Set by `classic.UserPromptSubmit` and
  `turn.start`; cleared by `classic.Stop` / `StopFailure` and
  `turn.complete`. **A tool settling never ends a turn.**
- `waiting` — the decisions a person still owes, keyed by the
  `tool_use_id` of the call that waits, or by tool name for a question or a
  notice that names no call. Added by `tool.check → ask`, `AskUserQuestion`'s
  `tool.call` and the pre-wait notification; removed by that call's
  `classic.PostToolUse` / `PostToolUseFailure` / `tool.call` end,
  `classic.PermissionDenied` — its own call only, never the whole set — or
  the turn's `Stop`.

`state = waiting.size ? blocked : busy ? working : idle`. `idle` is only
produced by an explicit turn end (`Stop`, `turn.complete`, `session.start`), so
a missed event leaves the pane `working` (safe) and never `idle` (a false
"ready for work" claim). The turn-end prose question of 0007 is a `blocked`
fact cleared by the next `UserPromptSubmit`; `Stop` carries the same reply as
`turn.complete`'s `answer` in `last_assistant_message`, so it survives that
event being sampled away. When several waits are open the first one inserted
supplies the pane text.

Delivery is at-least-once: a report that herdr does not accept (non-zero exit
or throw) gets three attempts, 400 ms apart and doubling; if all three fail the
report is marked unconfirmed, so the next event sends it again. Re-sending is
safe because herdr keeps the highest `--seq`. Dedupe compares the state **and**
the message — the second block may say something the first did not — so a
changed message is a report even when the state is unchanged. Reports stay
fire-and-forget: the retries run detached, so a hook never waits on herdr.

## Considered options

- **Pair `turn.complete` by `turnId` only**: narrows the window but keeps the
  sampled event as the sole truth; a missed `turn.start` still strands the pane.
- **Poll the pane or the model's text**: reads a projection, not the fact.
- **Report every event without dedupe**: 50 spawns per turn, against the point
  of the Mod.
- **Give up on `turn.*` entirely**: `Stop` is not verified on every TUI path
  yet, so `turn.complete` stays as a second idle witness.

## Consequences

- The classic hook set (`UserPromptSubmit`, `Stop`, `PostToolUse`,
  `PermissionDenied`) is now load-bearing, the same 2.183+ dependency 0005
  introduced. If it is missing, the adapter falls back to `turn.*` and the
  legacy failure modes.
- A question costs up to two extra reports (blocked, then working) — unchanged
  from 0005's behaviour.
- Sends are serialized only by `--seq`; two reports may be in flight at once.
  A failed older report's retry cannot win over a newer state because its seq is
  lower.
- A leaked `waiting` entry is cleared by `Stop`; a leaked `busy` never resolves
  to `idle` without a turn end, which is the safe direction.
- The classic hooks are registered by literal event name. Registering them
  from a loop produced no deliveries in the 2.183 probe, so identical-looking
  handlers stay written out; the duplication is the constraint, not sloppiness.
