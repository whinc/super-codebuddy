---
name: tool-call-intact
description: tool.check and tool.call hooks leave tool calls untouched.
tags: [observer, hooks, tools]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Write, Read]
expected_outcome: note.txt holds the sentinel and the reply quotes it.
---

Create a file named note.txt in the current directory containing exactly one line: herdr-sentinel-42

Then read it back and reply with that line and nothing else.
