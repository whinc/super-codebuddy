# 0009 — Read the turn end for dialogs

## Status

Accepted. Amends [0007](0007-turn-answer-not-screen.md), extends
[0008](0008-turn-facts-and-delivery.md).

## Context

A live TUI run on 2.184: the model request failed authentication, the TUI put
up `Select login method`, and the turn ended. The pane reported `idle` while
the sign-in gate was on screen, because the turn end came from the facts alone
and nothing read the pane.

The reply text cannot cover this. The engine still fills
`last_assistant_message` on a failed request, so "the turn said nothing" never
holds where it matters — the first attempt at the fix keyed on exactly that and
missed the case live.

0007's rule — the turn end never reads the pane — was written when the only
turn-end block was a prose question, and prose is what the pane cannot judge. A
dialog is the opposite: the pane is the only witness to it.

## Decision

`classic.Stop` reads the detection snapshot once, and a strict dialog hit turns
`idle` into `blocked`. The rest of the turn end keeps its shape:

- `turn.complete` still never reads; the prose question still comes from
  `answer`, never from the screen.
- `classify` gains the sign-in gate: the site picker (title plus two or more
  `Log in via` rows) and the wait (`Waiting for auth` plus a cancel hint).
  Both report `--message sign in`.
- A turn that already recorded a prose question reports it and does not read.
- The trust screen stays out: it is gone before `session.start` fires, so no
  event can observe it.

## Considered options

- **Read only when the turn produced no reply**: the engine still sets
  `last_assistant_message` on a failed request, so the condition never holds
  where it matters. This was tried and failed live.
- **Read on every idle transition from any event**: one read per tool settle,
  against 0008's point that settles are frequent and quiet.
- **Report the gate from the notification hook**: the gate is TUI chrome, not
  an engine event; no hook sees it.

## Consequences

- One extra `herdr pane read` per turn, about 250 ms and detached. When
  `turn.complete` reports idle first, the read's idle is deduped, so the pane
  still sees one report.
- A stale dialog at the very bottom of the pane would block until the next
  submit. The rules require a title and its option rows inside the bottom 40
  non-empty lines, which the TUI redraws past quickly.
- 0007's guarantee is intact: the prose question never comes from the pane.
