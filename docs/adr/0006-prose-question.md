# 0006 — Block on a prose sign-off that asks

## Status

Accepted. Extends ADR 0003.

## Context

A PTC session can end with the model asking in plain text: no `tool.check`,
no `AskUserQuestion`, no permission notification. The turn completes, the pane
reports `idle`, and the person never learns a decision is pending. A real
case ended with `回「accept all」或逐条改。` — no question mark at all, so
punctuation alone cannot catch it.

The turn-end screen has a stable anchor: `✔ Worked for …` sits above the
prompt box, and only the closing lines of the reply are above it. The person's
draft lives inside the box, below the banner, so it cannot be mistaken for the
reply.

## Decision

When a snapshot carries a `✔ Worked for` banner, take the three non-empty
lines above it (skipping rules) and report `blocked` with
`answer the question` if they end with `？`/`?` or match a small ask
vocabulary: reply with, let me know, tell me, which one, would you like,
should I, do you want, confirm, choose, 回复, 请确认, 确认后, 选一个, 选哪,
要不要, 是否继续/需要/可行, 需要我, 你定, 等你确认/回复/决定, 逐条改, 告诉我,
回「…」.

The turn-end idle read waits 300 ms before reading and retries once when
nothing matched. Both halves were measured on a live TUI: reading at
`turn.complete` caught the previous turn's sign-off and reported a block that
the person had already answered, and a reply that painted late left an early
read empty. Only `turn.complete` waits and retries; `session.start` and
`session.end` read once.

## Considered options

- **Only a trailing question mark**: misses the case that prompted this ADR.
- **Bare `回`**: matches 回答/返回/回顾 in ordinary summaries; the vocabulary
  is anchored to replies and decisions instead.
- **An engine signal**: `turn.complete` carries no reply text, and the screen
  is what the person is actually deciding on.
- **Every turn ends blocked**: no; a summary must stay `idle`
  (`test/fixtures/prose-done.txt`).

## Consequences

- Best effort in both directions: an unusual sign-off misses and leaves the
  pane `idle`; a summary line that happens to say `确认后` false-blocks. Herdr
  sends a notification for a block, so a false one costs one ping.
- The rule tracks TUI copy. The banner and the vocabulary are one file
  (`plugin/hooks/detect.ts`).
- A turn end reports idle about 300 ms later, and a miss costs one more pane
  read (about 250 ms). The person never waits on it.
