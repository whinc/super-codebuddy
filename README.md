# herdr-adapter

[简体中文](README.md) · [English](README.en-US.md)

[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fwhinc%2Fsuper-codebuddy%2Fmain%2Fplugin%2F.codebuddy-plugin%2Fplugin.json&query=%24.version&label=version&prefix=v&color=blue)](https://github.com/whinc/super-codebuddy/blob/main/plugin/.codebuddy-plugin/plugin.json)
[![test](https://github.com/whinc/super-codebuddy/actions/workflows/test.yml/badge.svg)](https://github.com/whinc/super-codebuddy/actions/workflows/test.yml)

让 Herdr 侧栏知道你的 CodeBuddy 是在干活、在等你，还是空着。不用再切回 CodeBuddy 才发现它一直在等你确认。

![Herdr 侧栏 agents 区列出两个 CodeBuddy 会话，右侧是打开的 CodeBuddy 面板](docs/images/herdr-agents.png)

**状态：** 实验性。社区适配器，与 Herdr 官方无关；跟随 Herdr 与 CodeBuddy Mod API 变动，issue 尽力回。[MIT](LICENSE) 许可。本仓库是一个单插件市场，插件名 `herdr-adapter`。

## 它解决什么

Herdr 给自己认识的 agent 报状态，CodeBuddy 不在 `herdr agent start --kind` 名单里，于是面板整轮都是 `unknown`——真正费时间的「等你确认」根本不会出现。这个 [CodeBuddy Mod](https://www.codebuddy.cn/docs/cli/mods) 把会话的 `working`、`blocked`、`idle` 报给 Herdr 面板。

它只做这一件事：不启动 CodeBuddy，不创建面板，也不改动这一轮。事件原样放行，上报失败不影响这一轮。用 CodeBuddy 自带 hooks 也能做同样的事，但每个事件都要起一个 Node 进程；这个 Mod 跑在 CLI 进程里，只在状态变化时 spawn 一次 herdr。

## 安装

需要 [Herdr](https://herdr.dev)（实测 0.9.5，用到 `pane report-agent`、`pane release-agent` 与 `pane read --source detection`）和带 Mods 的 CodeBuddy Code 2.183 或更新（beta，实测 2.183.0；PTC 提问的等待期上报依赖 2.183 的 `classic.Notification` 分发，2.182 及更早会整段停在 `working`）。只有跑测试才需要 Node。

在 CodeBuddy 会话里执行：

```sh
/plugin marketplace add whinc/super-codebuddy
/plugin install herdr-adapter@super-codebuddy
```

然后在 **Herdr 面板里**启动 `codebuddy`。新会话自动加载插件，`/reload-plugins` 让当前会话生效。

适配器只在面板里工作：`HERDR_ENV`、`HERDR_PANE_ID`、`HERDR_BIN_PATH` 由 Herdr 注入，三个都齐了才会上报。

## 你会看到什么

面板把这个会话列为 `codebuddy`：

| 面板状态 | 什么时候 |
| --- | --- |
| `idle` | 第一轮之前，或一轮结束后；`codebuddy --resume <id>` 可以从侧栏接回来 |
| `working` | 一轮进行中 |
| `blocked` | 有权限确认、模型提问、计划批准，或轮末用文字问你一件事，`--message` 说明在等哪一件 |

子 agent 的轮次被忽略：主轮还在跑就算忙。但子 agent 的权限确认照样报 `blocked`，等的是同一个人。

它怎么判断、边界在哪，见 [docs/how-it-works.md](docs/how-it-works.md)。

## 限制

- 不会把 CodeBuddy 加进 `herdr agent start --kind`：那需要 Herdr 二进制更新，[上游 PR](https://github.com/herdrdev/herdr/pull/4932) 还没合并。
- 只有在 Herdr 面板里启动的会话有效，普通终端里的 CodeBuddy 不上报。
- `blocked` 主要来自引擎在等待前发出的通知，轮末的文字提问靠底部快照猜（词表在 `plugin/hooks/detect.ts`，说法太隐晦会漏）；中文审批文案属预防性覆盖，2.183.0 的 TUI 本身是英文。
- 实验性：Herdr 或 CodeBuddy Mod API 变动都可能让它失效。

## 开发

`npm test`（Node >= 22.18）。沙箱规则、本地副本、`plugin eval` 与加载失败的排查见 [AGENTS.md](AGENTS.md)。

术语见 [GLOSSARY.md](GLOSSARY.md)。思路受 [herdr-codebuddy](https://github.com/Ziy1-Tan/herdr-codebuddy) 启发。
