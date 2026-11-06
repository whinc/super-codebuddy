# herdr-adapter

[![test](https://github.com/whinc/super-codebuddy/actions/workflows/test.yml/badge.svg)](https://github.com/whinc/super-codebuddy/actions/workflows/test.yml)

Herdr 用面板（pane）显示哪些在忙、哪些在等你、哪些空闲。Herdr 看不到 CodeBuddy
会话内部，所以这个 [CodeBuddy Mod](https://www.codebuddy.cn/docs/cli/mods) 把会话事件
翻译成 Herdr 状态：一轮开始时面板变成 `working`，权限确认等你操作时变成 `blocked`，
这轮结束时回到 `idle`——不用切窗口去看进度。

## 各事件上报什么

| CodeBuddy 事件 | 上报给 Herdr 的状态 |
| --- | --- |
| `session.start` | `idle`，附带会话 ID 与 `codebuddy --resume` 命令 |
| `turn.start` | `working` |
| `tool.check` → `ask` | `blocked`——有权限确认在等人处理 |
| `tool.call` 结算 | `working`——批准后清除 `blocked`，工具调用被拒绝也一样 |
| `session.compact` | `working`——压缩后这一轮继续 |
| `turn.complete` | `idle` |
| `session.end`（`clear`、`resume`） | `idle`——进程比这次对话活得久 |
| `session.end`（其他情况） | 释放 agent |

子 agent 循环被忽略：只要主轮还在进行，面板就算忙。

## 安装

在 CodeBuddy 中：

```
/plugin marketplace add whinc/super-codebuddy
/plugin install herdr-adapter@super-codebuddy
```

重启 CodeBuddy。上报从下一个会话开始；不在 Herdr 面板里（`HERDR_ENV` 未设置）时，
Mod 会正常加载但不做任何事。

本地开发时可以直接加载目录：

```sh
codebuddy --plugin-dir ./plugin
```

已安装的副本和 `--plugin-dir` 不能同时声明这个 Mod：引擎会因为身份重复拒绝加载，
启动前先移除其中一个。

## 为什么开销低

- **进程内中间件。** 钩子运行在 CLI 进程里，每个事件都不会额外启动 shell 或 Node 钩子进程。
- **边沿触发。** 上报按状态去重：一轮里五十次工具调用只发一次 `working` 和一次 `idle`，而非一百次。
- **不阻塞。** 上报不被 await，这一轮从不等待 Herdr。
- **单调 `--seq`。** 以时钟为种子的计数器让 Herdr 丢弃乱序到达的上报。

上一版 shell 钩子对每个事件都要先 fork 一个 shell、再 fork Node、再调起 herdr。
这个 Mod 只在可见状态变化时才启动 herdr。

Mod 无法打开 Herdr 的 NDJSON socket，所以上报走 `herdr pane report-agent`。
原因见 [ADR 0002](docs/adr/0002-mod-sandbox-cli-transport.md)。

## 开发

安装、沙箱规则与排查：[AGENTS.md](AGENTS.md)。

参考：[Add Herdr support to your agent](https://herdr.dev/docs/add-herdr-support/)。

## 致谢

本项目的思路受 [herdr-codebuddy](https://github.com/Ziy1-Tan/herdr-codebuddy) 启发。
