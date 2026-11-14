---
name: version-release
description: 发布本仓库的新版本：按语义版本 bump 插件版本号、用 changelog-writing 写变更日志、推送并更新 GitHub Release。只由人手动发版时调用。
disable-model-invocation: true
---

# 版本发布

把一个已经提交的改动范围变成可安装的新版本。发布只做三件事：**定版本**、**写 notes**、**发出去**。

## 仓库事实

| 版本位点 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `plugin/.codebuddy-plugin/plugin.json` | `version` |
| `.codebuddy-plugin/marketplace.json` | `plugins[].version`（`source` 目录有改动才 bump） |

- 仓库只有一个插件 `herdr-adapter`，三处版本号必须一致。
- 标签形如 `v0.3.1`，与 GitHub Release 同名。
- 没有 `CHANGELOG.md`；变更日志就是 Release 正文。
- `gh` 需要已登录（`repo` scope）；未登录就停下。

## 1. 确定范围

先确认工作区干净（`git status --porcelain` 为空）；有未提交改动就停下，先提交或 stash。

基线：
- 有 tag：`git describe --tags --abbrev=0 --match 'v*'`。
- 没有 tag：取 HEAD 之前最后一次改版本位点的提交：
  `git log -1 --format=%H -- package.json .codebuddy-plugin/marketplace.json plugin/.codebuddy-plugin/plugin.json`
  若它等于 HEAD，再往前一个提交。第一次发版（没有任何 tag）时，把基线和范围给人确认。

**完成条件**：打印基线、`git log --oneline <base>..HEAD`、`git diff --name-only <base>..HEAD`；范围内至少有一个插件文件（`plugin/`、`package.json`）。只有文档或测试改动时停下，问人是否真要发版。

## 2. 定版本

从范围内的 diff 判断，不只看提交标题：

- **Breaking**：已安装的用户必须改配置或降级 Herdr／CodeBuddy 才能继续。0.x 阶段 bump minor（0.3.0 → 0.4.0）；≥1.0 bump major。
- **Feature**：新增可观察能力（新信号、新规则）→ minor。
- **Fix／文档／测试／重构**：无新增能力 → patch。

多插件仓库：只 bump `source` 目录有改动的插件；标签取最高的新版本。

**完成条件**：写下 `vX.Y.Z`，并给出决定这个位的那条改动。

## 3. Bump 版本

改上表三处。只有版本号变化。

**完成条件**：`git diff` 只出现版本号；三处值相等。

## 4. 写变更日志

调用 `changelog-writing` skill，交付面 = **GitHub Release 正文**。把它需要的答案直接给出，不要反过来采访用户：

- 范围：`<base>..HEAD`
- 版本：`vX.Y.Z`
- 读者：插件的使用者和维护者
- 规范：没有既有 changelog 规范；提交是 conventional commits
- Breaking：由第 2 步决定

要求它跑完自己的验证门：每条能对上 diff、没有编造的数字、breaking 三段齐全。把最终正文写进临时文件：

```sh
NOTES=$(mktemp /tmp/super-codebuddy-notes.XXXXXX)
```

**完成条件**：notes 非空；每条都能在 diff 里找到依据；没有漏掉的 breaking。

## 5. 过门禁

```sh
npm test
```

**完成条件**：退出码 0。失败就停下，不要发版。

## 6. 提交、推送、发布

把版本、改动文件清单和完整 notes 给用户看，得到确认后再执行：

```sh
git add package.json plugin/.codebuddy-plugin/plugin.json .codebuddy-plugin/marketplace.json
git commit -m "chore: release vX.Y.Z"
git push origin main
gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file "$NOTES"
```

- release 已存在：用 `gh release edit vX.Y.Z --notes-file "$NOTES"`，不要重复创建。
- tag 已存在且指向别的提交：停下问人，不移动已发布的 tag。
- push 失败：不创建 release。
- 不 force-push，不 amend 已推送的提交。

**完成条件**：`gh release view vX.Y.Z --json url,tagName` 打出链接与 tag；tag 指向本次发布提交。

## 收尾

报告：版本、Release 链接、notes 里仍待人工确认的项（未实测的数字、缺少的迁移链接）。清理临时 notes 文件。
