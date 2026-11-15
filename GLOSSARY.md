# herdr-adapter

一个把 CodeBuddy 会话状态上报给 Herdr 的 Mod。它要判断的只有一件事：面板里的这个会话，是在干活、在等人，还是空着。

## Language

**Agent state（代理状态）**:
Herdr 面板上代理的生命周期状态：`idle`、`working`、`blocked`。
_Avoid_: status, phase

**Idle fallback（空闲回退）**:
检测快照没有命中任何已知阻塞界面时采用的 `idle` 结论；它是默认值，不代表已经确认空闲。
_Avoid_: default idle, unknown

**Blocked UI（阻塞界面）**:
面板底部可见、正在等待人处理的审批、提问、权限或登录界面。
_Avoid_: dialog, modal, prompt

**Sign-in gate（登录门槛）**:
TUI 中途弹出的登录方式选择或等待认证界面；它挡在模型请求前面，和权限确认一样算 `blocked`。首轮之前的目录信任界面不在此列：那时会话还没开始，适配器看不到它。
_Avoid_: login prompt, auth modal

**Detection snapshot（检测快照）**:
Herdr 屏幕检测所用的底部缓冲区文本；截到面板当前可见的底部，而不是滚动区历史。
_Avoid_: screen, capture, buffer

**Screen fallback（屏幕兜底）**:
准备上报 `idle` 时，依据检测快照把状态改判为 `blocked` 的兜底判断。
_Avoid_: screen detection, text detection

**Hook state（钩子状态）**:
仅由 CodeBuddy 会话事件推出的状态，不读屏幕。
_Avoid_: real state, event state

**Turn fact（轮次事实）**:
维护面板状态用的两个事实：这一轮是否在跑（`busy`），以及有没有还在等人的决定（`waiting`）。状态是它们的函数，不是事件流的流水账。
_Avoid_: current state, turn flag

**Witness（见证）**:
能翻动一个事实的事件。只有保证每次都会发生的事件才算见证（`classic.UserPromptSubmit`、`classic.Stop`）；采样得到的事件（`turn.start`、`turn.complete`）只能作备份。
_Avoid_: signal, trigger, source

**Wait（等待项）**:
一条还欠着人的决定，按发起它的工具调用（`tool_use_id`）记着，值就是面板上显示的那句话。由该调用结算、权限被拒或轮末清除。
_Avoid_: pending, blocker, queue entry
