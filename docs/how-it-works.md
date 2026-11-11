# 工作原理

![流程图：Herdr 把环境变量注入面板进程，Mod 建好 adapter，监听会话事件，再用 herdr pane report-agent 把状态报回去](images/flow-zh.svg)

Herdr 把 `HERDR_ENV`、`HERDR_PANE_ID`、`HERDR_BIN_PATH` 写进它启动的进程。Mod 在第一次钩子调用时读这三个变量，齐全才建 adapter。此后每个钩子只做观察，事件原样放行；引擎在弹出确认或提问前会发一条权限通知，Mod 通过 `classic.Notification` 收到后立刻报 `blocked`，工具结算或轮次结束时再报回 `working` / `idle`；要报 `idle` 时仍先读一次检测快照兜底；状态可见地变了，才发一次 `herdr pane report-agent`，带上面板、状态和单调递增的 `--seq`。侧栏的状态由此而来，重启后还能用 `codebuddy --resume <id>` 把会话接回来。

## 面板显示什么

| CodeBuddy 事件 | 上报给 Herdr 的状态 |
| --- | --- |
| `session.start` | `idle`，附带会话 ID 与 `codebuddy --resume` 命令；读屏命中阻塞界面则报 `blocked` |
| `turn.start` | `working` |
| `tool.check` → `ask` | `blocked`：有权限确认在等人处理，带 `--message waiting for permission` |
| `tool.call` → `AskUserQuestion` | `blocked`：模型自己的提问在等人回答，带 `--message answer the question`；非 PTC 会话在这一步就拦住 |
| `classic.Notification` → `permission_prompt` | `blocked`：引擎在等待前发出 `needs your permission to use <tool>`；PTC 提问、计划批准都在这时拦住，回答或取消后由工具结算报回 |
| `tool.call` 结算 | 轮内 `working`；轮外 `idle`：空闲时别的 Mod 用 `$.ui.ask` 提问，答完回空闲 |
| `turn.complete` | `idle`；读屏命中阻塞界面则报 `blocked` |
| `session.end`（`clear`、`resume`） | `idle`：进程比这次对话活得久；读屏命中则报 `blocked` |
| `session.end`（其他情况） | 释放 agent |

子 agent 的 turn 循环被忽略：只要主轮还在进行，面板就算忙。但子 agent 的权限确认照样报 `blocked`，等的是同一个人。

## 屏幕兜底

Herdr 的检测清单不能直接给 CodeBuddy 用：官方文档写明，新增一个它不认识的 agent 仍需要 Herdr 二进制更新，本地 manifest 只补规则。所以这一步放在 Mod 里。

每次准备报 `idle`，Mod 用 `herdr pane read <pane> --source detection` 读一次 Herdr 屏幕检测用的底部快照，再跑一组严格规则：权限确认、`AskUserQuestion`、计划批准（`Ready to code?`）。规则要求标题和选项行同时出现在面板底部；转写区里的历史文字不算。命中就报 `blocked` 并带 `--message`（`waiting for permission`、`answer the question`、`approve the plan`、`approve the workflow`），没命中、读失败或 Herdr 版本太旧都回退 `idle`。

每次读超过 1.5 秒算失败，失败后这个进程不再读屏。中文规则按现有审批文案尽力匹配；2.183.0 的 TUI 本身是英文，中文属于预防性覆盖。

## 等待前的通知

PTC 会话里模型提问由 REPL 工具内部的 AskService 承接：引擎先停在 `waitForPtcQuestion`，等人答完才执行内层工具、触发 `AskUserQuestion` 的 `tool.call`。等待前引擎会先走一遍 `onWillPrompt`，发出 `classic.Notification`（`notification_type` 为 `permission_prompt`，消息是 `needs your permission to use <工具名>`）。

2.182 及更早版本里，Mod 收不到这条通知：`HookManager.hasHooks` 不把 Mod 注册的 classic 钩子算进去。2.183 加入了 `modsClassicHookExists`，注册 `classic.Notification` 的 Mod 会让 `hasHooks` 为真，通知在等待前就到达。Mod 只认 `needs your permission to use ` 前缀，`AskUserQuestion` 报 `answer the question`，`ExitPlanMode` 报 `approve the plan`，其他报 `waiting for permission`。不用 `notification_type` 单独判断，是因为 `$.ui.notify` 也会落成 `permission_prompt`。

## 为什么开销低

钩子跑在 CLI 进程里，每个事件都不另外启动 shell 或 Node 钩子进程。上报按状态去重，一轮里五十次工具调用只发一次 `working` 和一次 `idle`。等待前的通知直接来自引擎事件，轮内不再读屏；只有每次 idle 转变读一次检测快照（本机约 250ms），读屏和上报都在后台，这一轮从不等待 Herdr。

用 CodeBuddy 的 hooks（事件触发的外部脚本）实现同一件事，每个事件都要起一个 Node 进程，再由它调用 herdr，一轮五十次工具调用就是上百次进程启动。这个 Mod 只在可见状态变化时 spawn 一次 herdr，外加每次 idle 转变一次读屏。

## 相关 ADR

- [0001-socket-first-transport](adr/0001-socket-first-transport.md)
- [0002-mod-sandbox-cli-transport](adr/0002-mod-sandbox-cli-transport.md)
- [0003-screen-blocked-detection](adr/0003-screen-blocked-detection.md)
- [0004-poll-while-working](adr/0004-poll-while-working.md)（已被 0005 取代）
- [0005-prompt-notification](adr/0005-prompt-notification.md)
