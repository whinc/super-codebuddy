# 0005 — Report blocked from the engine's prompt notification

## Status

Accepted. Supersedes ADR 0004's in-turn polling.

## Context

In a PTC session `AskUserQuestion` is a nested ask inside the `REPL` tool:
`waitForPtcQuestion` waits for the person before `executeNested` raises
`tool.call`, so the tool hook reports only after the answer (ADR 0004). The
wait path calls `onWillPrompt` first, which raises the engine's Notification
hook with `notification_type: permission_prompt` and the message
`needs your permission to use <tool>`.

A Mod could register `classic.Notification`, but until 2.182 it never heard
the event: `HookManager.hasHooks` did not count Mod classic hooks, so
`executeNotificationHooks` returned before dispatching. 2.183 adds
`modsClassicHookExists` to that check, so a Mod that registers
`classic.Notification` makes `hasHooks(Notification)` true and receives the
notification before the wait. The 2.182 bundle has no
`modsClassicHookExists`; the full TUI check is under Verification below.

## Decision

Register `classic.Notification` and report `blocked` for messages starting
with `needs your permission to use `. `AskUserQuestion` maps to
`answer the question`, `ExitPlanMode` to `approve the plan`, anything else
to `waiting for permission`. Delete the in-turn screen poll. The idle-time
snapshot from ADR 0003 stays as the fallback for a UI no hook announced.

## Verification

A full TUI run on 2.183.0 (macOS, 140x45, PTC selected with
`/agent-mode ptc`, a probe copy of this Mod loaded with `--plugin-dir` and
reporting under `--source custom:codebuddy-probe`). The prompt asked the
model to call `AskUserQuestion` once ("Pick a color", red/blue). With the
question UI open and unanswered, the fake herdr log recorded:

| time | report |
| --- | --- |
| 20:03:55 | `working` |
| 20:03:56 | `blocked --message "answer the question"` (UI open, no answer yet) |
| 20:04:12 | `working` (after Submit answers) |
| 20:04:14 | `idle` (turn end) |

The event trace was `tool.call(REPL)` → `classic.PreToolUse(REPL)` →
`classic.Notification(permission_prompt)` → wait → `classic.PostToolUse`
`(AskUserQuestion)` → `tool.call(AskUserQuestion)` → `classic.PostToolUse`
`(REPL)`. The fake herdr answered every `pane read` with an empty snapshot,
so the block could not have come from screen detection; the installed 0.1.0
plugin without the notification hook reported only `working` through the
wait.

## Considered options

- **Keep polling**: 30 pane reads a minute per running turn, plus TUI copy
  drift. The notification is one engine event and needs no timer.
- **Use `tool.call`**: in PTC it lands after the answer, the bug ADR 0004
  worked around.
- **Use `ui.render`**: the dialog is not a render site the Mod sees.
- **Key on `notification_type` alone**: `$.ui.notify` also becomes a
  `permission_prompt` notification, so the message prefix is the
  discriminator.

## Consequences

- The report tracks the engine's English prompt message. A wording change is a
  one-line diff in `plugin/hooks/herdr.ts`; a miss leaves the pane `working`,
  never a false block.
- 2.183 is the minimum CodeBuddy for pre-answer PTC reporting. On 2.182 and
  older a PTC wait stays `working`; the poll is gone.
- A prompt dismissed inside a REPL cell that keeps running stays `blocked`
  until that cell's `tool.call` settles, whose `toolDone` reports again.
