# 0003 — Screen fallback for blocked detection

## Status

Accepted. The "no polling" part is superseded by ADR 0004.

## Context

Herdr's detection manifests are per known agent. Its docs say adding a new agent
still needs a Herdr binary update, so a local `codebuddy.toml` cannot teach
Herdr's process detection. The Mod already reports `blocked` from `tool.check`
and `AskUserQuestion` (the latter also covers another Mod's `$.ui.ask`), but a
visible permission/question UI that no hook reported — a missed event, or a UI
path CodeBuddy adds later — would leave the pane `idle`. Herdr exposes the same
bottom-buffer snapshot its screen detection uses at
`herdr pane read --source detection`.

## Decision

On each idle transition, read the detection snapshot once (1.5 s timeout) and
apply a small, strict rule set for visible permission, question, and plan
approval UIs. A hit reports `blocked` with `--message`; a miss, a failed read,
or an older Herdr reports `idle`. Hook-reported `blocked` and `working` are
never read against the screen and never downgraded. There is no polling.
Chinese rules are best-effort because the 2.181.0 TUI is English.

## Considered options

- **A local Herdr manifest**: impossible for an agent Herdr does not know; its
  docs require a binary update for process detection.
- **Polling the snapshot**: every 2 s per pane is hundreds of extra herdr
  processes per hour, against the project's low-overhead premise.
- **Screen as the authority for blocked**: `tool.check` fires before the UI
  renders, so verifying or replacing hook blocks with the screen would drop
  real blocks.

## Consequences

- One extra herdr read per idle transition, about 250 ms locally. The turn is
  already over, and the read is not awaited.
- Rules track CodeBuddy's TUI copy. A miss falls back to `idle`, never a false
  block; a TUI copy change is a one-file diff in `plugin/hooks/detect.ts`.
- `pane read --source detection` needs Herdr 0.9.5+. The first failure disables
  screen checks for the process.
- `turnActive` is tracked so an `AskUserQuestion` answered outside a turn
  returns to `idle` instead of `working`.
