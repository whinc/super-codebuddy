# herdr-adapter

上报 CodeBuddy 会话状态给 Herdr 的 CodeBuddy Mod。给人看的文档：[README.md](README.md)。

## Mod 沙箱规则

`plugin/hooks/*.ts` 运行在隔离的 VM 里，以下规则由 `npm test` 强制检查：

- 只能导入 `plugin/` 内的相对文件。`node:*` 与 `process` 都不可用。
- `codebuddy-code` 只能做类型导入：`import type`，不能作为值导入。
- 环境变量、文件、进程与 HTTP 都来自 `$`：`$.env.get`、`$.fs`、`$.process.run`、`$.http.fetch`。
- 在首次使用钩子时再构建 adapter；模块加载阶段没有 `process.env`。

传输为什么只能走 CLI：[docs/adr/0002-mod-sandbox-cli-transport.md](docs/adr/0002-mod-sandbox-cli-transport.md)。

## 验证

`npm test`（Node >= 22.18）。说改动已经可用之前先跑一遍。

## Mod 没有加载？

查看 `~/.codebuddy/logs/<date>/<project>__*.log` 里的 `mods:` 行。

- `Duplicate Mod identity`：已安装的副本和 `--plugin-dir` 都声明了它，移除一个。
- `Mod import node:* is unavailable`：违反了上面某条沙箱规则。
