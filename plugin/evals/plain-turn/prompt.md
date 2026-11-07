---
name: plain-turn
description: A turn with no tools still completes normally with the adapter loaded.
tags: [observer, hooks]
max_turns: 4
timeout_seconds: 180
allowed_tools: []
expected_outcome: The reply is READY; nothing in the session was changed by the hooks.
---

Reply with the single word READY and nothing else. Do not use any tools.
