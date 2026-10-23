# dsh-review-threads

[![npm 版本](https://img.shields.io/npm/v/dsh-review-threads.svg)](https://www.npmjs.com/package/dsh-review-threads)
[![npm 下载量](https://img.shields.io/npm/dm/dsh-review-threads.svg)](https://www.npmjs.com/package/dsh-review-threads)
[![验证状态](https://github.com/huandu/dsh-review-threads/actions/workflows/verify.yml/badge.svg)](https://github.com/huandu/dsh-review-threads/actions/workflows/verify.yml)
[![DeepSeek Harness 插件](https://img.shields.io/badge/DSH-plugin-4B32C3.svg)](https://github.com/topics/dsh-plugin)
[![MIT 许可](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向 DeepSeek Harness diff 的持久化 GitHub 式评审线程。

插件接管官方 `changes-review` tab，并继续使用官方 turn diff 数据源。一个
Review 绑定一个 diff，内部包含多个行级 Thread。用户 draft 只有在显式提交
Review 后才对 AI 可见。AI 可以立即添加评论，但不能删除评论或完成 Thread。

## 状态

`0.1.1` 是当前正式版本。DeepSeek Harness 本身仍处于 preview 阶段，安装前请
确认兼容范围。

## 要求

- DeepSeek Harness `0.2.1-rc.1` 到 `0.2.1`
- Node.js 22.18 或更新版本
- 已提交 revision review 需要 Git

## 安装

```bash
dsh plugin --profile web add dsh-review-threads
```

安装后重启 profile。卸载插件会恢复官方 Review tab，评审数据仍保留在 profile
的 DSH storage 中。

## Review 命令

- `/review` 打开当前工作区未提交的变更，包括未跟踪文件。
- `/review <base>..<head>` 打开已提交的 revision 区间；使用
  `/review <base>...<head>` 时按 merge-base 比较。
- 两种比较都可以追加 `-- <paths...>` 限定仓库路径。
- 使用 `/review bind <base>..<head>` 检查 revision 是否与当前会话的 working
  Review 补丁一致，并在面板中确认绑定。
- `/review-diagnostics` 查看不包含评论正文的本地存储计数。
- `/review-clear-drafts` 丢弃当前会话所有未提交 draft。

该命令只打开 Review 面板，不发送对话消息，也不会启动 AI 回合。

## 发布

为与包版本一致的 tag 创建正式 GitHub Release 后，
`.github/workflows/publish.yml` 会验证项目、构建并通过 npm Trusted Publisher
发布。GitHub 中不保存 npm token。

## 开发

```bash
pnpm install
pnpm verify
```

## 文档

- [需求](docs/requirements/requirements.md)
- [设计](docs/design.md)
- [开发计划](docs/development-plan.md)
- [兼容性](docs/compatibility.md)
- [设计决策](docs/decisions/)

## 许可

MIT
