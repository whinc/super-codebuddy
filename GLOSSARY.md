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
面板底部可见、正在等待人处理的审批、提问或权限界面。
_Avoid_: dialog, modal, prompt

**Detection snapshot（检测快照）**:
Herdr 屏幕检测所用的底部缓冲区文本；截到面板当前可见的底部，而不是滚动区历史。
_Avoid_: screen, capture, buffer

**Screen fallback（屏幕兜底）**:
准备上报 `idle` 时，依据检测快照把状态改判为 `blocked` 的兜底判断。
_Avoid_: screen detection, text detection

**Hook state（钩子状态）**:
仅由 CodeBuddy 会话事件推出的状态，不读屏幕。
_Avoid_: real state, event state
