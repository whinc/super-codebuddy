# 0007 — Take the prose question from the reply, not the screen

## Status

Accepted. Supersedes ADR 0006's screen rule. ADR 0003's idle-time dialog
fallback remains.

## Context

ADR 0006 read the prose sign-off from the bottom snapshot: the three lines
above `✔ Worked for`. At a live turn end that window can hold task chrome
instead of reply text. A PTC session ended with a running REPL row above the
banner — `✺ 等人工确认后做云端验收… (… running REPL … Task running for a
while)` — and the vocabulary matched `确认后` in the task title. The pane
reported `blocked` while the work continued.

`turn.complete` already carries the reply. `answer` is the turn's final
visible assistant text, and `reason` says why the turn ended.

## Decision

At `turn.complete`, judge the prose question from `e.answer` alone. Only
`reason === 'answer'` can block; `aborted`, `refusal` and `error` report
idle. Take the last three non-empty lines of `answer` and apply the same ask
vocabulary and trailing question mark rule. Do not read the pane at turn end,
and remove the 300 ms wait and the retry read.

The idle-time snapshot stays for visible dialogs only: permission, question,
plan and workflow UIs. Prose on the pane is never a blocker.

## Considered options

- **Keep the screen rule and add a running-task guard**: fixes one row shape,
  but keeps the projection and the TUI copy coupling.
- **Drop the prose rule**: loses the case ADR 0006 fixed.
- **Poll `$.session.messages()`**: the event already carries the text.

## Consequences

- Pane chrome, task rows, terminal width and TUI copy no longer affect the
  prose verdict.
- A turn end costs no pane read and no wait.
- An older engine that leaves `answer` empty reports idle, never a false
  block.
- The word list tracks the reply's markdown text now; it stays one file.
