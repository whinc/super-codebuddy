# herdr-adapter

[简体中文](README.md) · [English](README.en-US.md)

[![test](https://github.com/whinc/super-codebuddy/actions/workflows/test.yml/badge.svg)](https://github.com/whinc/super-codebuddy/actions/workflows/test.yml)

Herdr reports state for the agents it has a detector for; `herdr agent start --kind` lists about two dozen. CodeBuddy is not one of them, so its pane shows `unknown` for the whole turn, and you only find out it was waiting on a permission prompt when you switch back. This [CodeBuddy Mod](https://www.codebuddy.cn/docs/cli/mods) reports `working`, `blocked` and `idle` for the session to Herdr, so the pane can answer that.

![Herdr sidebar listing two CodeBuddy sessions under agents, with a CodeBuddy pane open beside it](docs/images/herdr-agents.png)

**Status:** 0.1.0, experimental. Community adapter, not affiliated with Herdr; it tracks Herdr and CodeBuddy Mod API changes, issues answered best-effort. MIT licensed. This repo is a one-plugin marketplace, and the plugin is `herdr-adapter`.

## What it is

A CodeBuddy Mod: TypeScript hooks installed from this repo's marketplace and loaded into the CLI process. It is not a Herdr plugin, and it does not add CodeBuddy to `herdr agent start --kind`.

It does two things outside the process: one `herdr pane report-agent` call per visible state change for the pane CodeBuddy already runs in, and one `release-agent` when the session really ends. It does not start CodeBuddy, create panes, or touch the turn. Every event passes through, and a failed report is dropped.

## Install

Needs [Herdr](https://herdr.dev) with `pane report-agent` and `pane release-agent` (verified on 0.9.5), and CodeBuddy Code with Mods (beta; verified on 2.181.0). Node is only needed for the tests.

In a CodeBuddy session:

```sh
/plugin marketplace add whinc/super-codebuddy
/plugin install herdr-adapter@super-codebuddy
```

Then start `codebuddy` inside a Herdr pane: a new session loads the plugin, and `/reload-plugins` applies it to the current one. Anywhere else the adapter stays off. Herdr injects `HERDR_ENV`, `HERDR_PANE_ID` and `HERDR_BIN_PATH`, and without all three it reports nothing.

The pane lists the session as `codebuddy`: `idle` before the first turn, `working` while one runs, and `blocked` while a permission prompt, or the model's own question, waits on you.

## Why this exists

What a pane can report comes from Herdr's detector list. With no entry for CodeBuddy, the pane stays `unknown` while a turn runs, and `blocked` never appears. That is the expensive one: the turn is stopped until you answer.

## How it works

![Flow diagram: Herdr injects the env into the pane, the Mod builds an adapter, watches session events, then reports state back with herdr pane report-agent](docs/images/flow-en.svg)

Herdr writes `HERDR_ENV`, `HERDR_PANE_ID` and `HERDR_BIN_PATH` into the process it starts. The Mod reads them on its first hook call and builds an adapter only if all three are present. From then on every hook is observation. The event passes through untouched; a visible change becomes one `herdr pane report-agent` call carrying the pane, the state and a monotonic `--seq`. That call puts the state in the sidebar, and keeps `codebuddy --resume <id>` for the next restart.

### What the pane shows

| CodeBuddy event | Reported to Herdr |
| --- | --- |
| `session.start` | `idle`, with the session id and a `codebuddy --resume` command |
| `turn.start` | `working` |
| `tool.check` → `ask` | `blocked`: a permission prompt is waiting on you |
| `tool.call` → `AskUserQuestion` | `blocked`: the model's own question is waiting on you |
| `tool.call` settles | `working`: clears `blocked` once approved, denial included |
| `turn.complete` | `idle` |
| `session.end` (`clear`, `resume`) | `idle`: the process outlives the conversation |
| `session.end` (anything else) | releases the agent |

Subagent turns are ignored, so the pane stays busy while the main turn runs. A subagent's permission prompt still reports `blocked`, because it waits on the same person.

## Why it is cheap

Hooks run inside the CLI process, so no shell or Node hook process starts per event. Reports are deduplicated by state: fifty tool calls in one turn send one `working` and one `idle`. They are never awaited, so a turn doesn't wait on Herdr.

Built on CodeBuddy hooks (external scripts run per event) instead, the same job starts a Node process for every event, and that process calls herdr: fifty tool calls in a turn add up to hundreds of process starts. This mod spawns herdr only when the visible state changes.

## Development

Needs CodeBuddy Code with Mods (beta; verified on 2.181.0). The hooks are TypeScript under `plugin/hooks/`, and `npm test` needs Node >= 22.18.

```sh
npm test
```

`npm run eval` scores the plugin with `codebuddy plugin eval`: two cases (a plain turn, and a tool call that must survive the `tool.check` / `tool.call` hooks), three runs each, against a no-plugin baseline. The observer must score the same with and without it, so a non-zero delta is a bug. The report lands in `plugin/evals/results/`.

To run a checkout instead of the marketplace install:

```sh
codebuddy --plugin-dir ./plugin
```

Loading that copy alongside the marketplace install logs `Duplicate Mod identity`, so keep one of the two.

Sandbox rules, verification and troubleshooting are in [AGENTS.md](AGENTS.md). References: [CodeBuddy Mods](https://www.codebuddy.cn/docs/cli/mods), [Add Herdr support to your agent](https://herdr.dev/docs/add-herdr-support/).

## Credits

The idea comes from [herdr-codebuddy](https://github.com/Ziy1-Tan/herdr-codebuddy).

[herdrdev/herdr#4932](https://github.com/herdrdev/herdr/pull/4932) asks Herdr to ship CodeBuddy support upstream. It is still open; until it lands, this adapter is the stand-in. Once Herdr reports CodeBuddy natively, the plugin can retire.
