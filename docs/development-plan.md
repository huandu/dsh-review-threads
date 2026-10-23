# 开发执行计划

状态：待用户最终确认后执行。本文件是后续实现的默认工作清单和时间顺序依据。

## 1. 执行原则

1. 以 [01-requirements.md](01-requirements.md) 和 [02-solution-design.md](02-solution-design.md) 为行为契约。
2. 每个可交付 commit 同时包含实现、测试和相应文档。
3. 每个阶段结束都必须能独立运行 `pnpm verify`。
4. 优先完成纵向切片，尽早在真实 DSH profile 中验证，不只做孤立模块。
5. 官方 API 优先。若必须使用未公开契约，先写 ADR 和兼容性降级，再实现。
6. 任何 schema、权限或 verdict 语义变化先更新设计和 ADR。
7. 所有业务状态由 Host 负责，Client 不自行推断 Review 是否可 Approve。
8. 未通过真实 profile E2E 的功能不声明完成。

## 2. 工作包总览

| 阶段 | 工作包                  | 依赖  | 主要产物                           |
| ---- | ----------------------- | ----- | ---------------------------------- |
| P0   | 仓库与治理初始化        | 无    | AGENTS、docs、许可证、构建与 CI    |
| P1   | DSH 兼容性探针          | P0    | 可接管官方 Review tab 的最小插件   |
| P2   | Scope 与持久化基础      | P1    | 稳定 scope、storage domain、schema |
| P3   | Review 聚合与可见性     | P2    | Review、Thread、Draft、Submission  |
| P4   | Diff 客户端与 Thread UI | P1-P3 | 官方风格 diff 和行级讨论           |
| P5   | Review 提交与 Approve   | P3-P4 | verdict、提交、自动下一轮          |
| P6   | AI Skill 与工具         | P3-P5 | AI 读评论、写评论、告知用户        |
| P7   | 实时同步                | P3-P6 | 同 Host 多会话 SSE 同步            |
| P8   | Working/Revision Scope  | P2-P7 | work scope、`/review`、跨会话共享  |
| P9   | Commit 绑定与稳定化     | P8    | working 到 rev 的原子绑定          |
| P10  | 发布准备                | P0-P9 | E2E、打包、文档、npm/GitHub 发布   |

## 3. P0：仓库与治理初始化

### T0.1 创建项目骨架

依赖：无。

产物：

- `$PERSONAL/dsh-review-threads`
- Git 仓库，默认分支 `main`
- pnpm 项目
- TypeScript strict
- 构建、测试、lint、format 配置
- 最小 `cordis.patch.yml`
- 最小可加载的 Host/Client 入口

验收：

- 空插件可在目标 DSH 中加载。
- `pnpm build` 和 `pnpm typecheck` 成功。
- 不依赖开发机绝对路径。

### T0.2 项目治理文件

依赖：T0.1。

产物：

- `AGENTS.md`
- `LICENSE`（MIT）
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `README.md`
- `README.zh.md`
- `CHANGELOG.md`

验收：

- `AGENTS.md` 明确文档与代码同 commit。
- 许可证和包清单均为 MIT。
- 所有贡献命令可在干净 checkout 中运行。

### T0.3 迁移设计文档

依赖：T0.1。

产物：

- `docs/README.md`
- `docs/requirements/original.md`
- `docs/requirements/requirements.md`
- `docs/design.md`
- `docs/compatibility.md`
- `docs/decisions/0001-take-over-official-review-tab.md`
- `docs/decisions/0002-review-aggregate-and-approval.md`
- `docs/decisions/0003-scope-identity-and-storage.md`

验收：

- 文档内容与本设计一致。
- 文档链接全部有效。
- `AGENTS.md` 要求未来设计变更同步新增 ADR。

### T0.4 质量门禁与 CI

依赖：T0.1-T0.3。

产物：

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check:docs`
- `pnpm pack:check`
- `pnpm test:e2e`
- 汇总命令 `pnpm verify`
- GitHub Actions `verify.yml`

验收：

- 新仓库首个空实现 commit 通过 `pnpm verify`。
- 任一 lint warning、格式差异、测试失败或文档链接损坏都使命令失败。
- CI 与本地使用相同命令。

建议提交：

`chore: bootstrap dsh-review-threads`

## 4. P1：DSH 兼容性探针

### T1.1 锁定 DSH 公共契约

依赖：P0。

工作：

- 确认测试版本为 `0.2.1-rc.2` 与 `0.2.1-rc.3`。
- 核对 `sidebarRightTabs`、`workspaceChanges`、`connection.fetch`、`storageDomain`、`tools`、`commands` 和 Skill 打包入口。
- 在 `docs/compatibility.md` 记录精确版本和已使用 API。

验收：

- 所有依赖来自公开包导出。
- 不使用 `@deepseek-ai/dsh` 内部相对路径。

### T1.2 接管官方 `changes-review` tab

依赖：T1.1。

工作：

- 注册 `extension` 优先级 tab，kind 为 `changes-review`。
- 保持官方资源地址格式。
- 解析 `sessionId`、`eventSeq`、`turn`。
- 在冲突或契约不匹配时 fail closed，不覆盖出错的官方行为。

验收：

- 官方 turn-tail 改动文件卡打开插件 tab。
- rc2/rc3 都能取得同一地址。
- 移除插件后官方 tab 自动恢复。

### T1.3 读取官方 turn diff

依赖：T1.2。

工作：

- 通过 `ctx.workspaceChanges.summary()` 获取文件摘要。
- 通过 `ctx.workspaceChanges.diff()` 获取文件对比。
- 验证 created/deleted/coarse/binary/oversized 状态。
- 用公开 route 或 Remote 为 Client 建立代理，不暴露 Host cwd。

验收：

- 能加载单文件和多文件 turn diff。
- 与官方 UI 的增删行数和工作区路径一致。

### T1.4 Diff 功能对齐清单

依赖：T1.3。

必须对齐：

- 文件选择器
- 文件增删统计
- unified/split
- wrap
- syntax highlight
- 真实新旧行号
- hunk header
- 创建/删除/空 diff/过粗 diff 提示
- 打开整文件

验收：

- 对照官方 Review tab 截图逐项通过。
- 5,000 行截断和 oversized 降级行为一致。

建议提交：

`feat: take over the official review tab behind a compatibility adapter`

## 5. P2：Scope 与持久化基础

### T2.1 实现 repo identity

依赖：T1.1。

工作：

- 规范化 remote URL。
- 无 remote 时使用 Git common dir。
- 处理 worktree、submodule 目录和缺少 Git 的降级。
- 不把凭据、用户名或 token 写入 repo identity。

验收：

- 同一仓库的 worktree 解析到同一 repo identity。
- 不同仓库不碰撞。

### T2.2 实现 scope key

依赖：T2.1。

工作：

- Turn scope key。
- Work scope key。
- Revision scope key。
- diffSpec 哈希。
- 输入顺序稳定、JSON 规范化、SHA-256。

验收：

- 相同输入跨进程稳定。
- 符号 ref 移动不会被误认成同一 revision scope。
- path filter 或 diff 选项变化会生成不同 scope。

### T2.3 声明 storage domain

依赖：T2.1。

工作：

- 定义 `review_threads` domain，version 1，`per-record`。
- 实现 schema 校验和记录上限。
- 实现 open/close 生命周期与 disposal。
- 增加 schema/version 错误测试。

验收：

- 重启后记录恢复。
- 任一损坏记录按设计 fail loud 或显式迁移，不静默清空。

### T2.4 Scope 查询服务

依赖：T2.2-T2.3。

工作：

- `scopeStatus` 服务。
- scope → Review 的唯一映射。
- scope 元数据查询。
- 过期或不可用 diff 的状态。

验收：

- 同一 scope 重复打开返回同一 Review。
- 不同会话不重复创建 Review。

建议提交：

`feat: add stable review scopes and persistent storage`

## 6. P3：Review 聚合与可见性

### T3.1 Review 聚合模型

依赖：P2。

工作：

- Review 记录 schema。
- `currentDecision`、`latestSubmissionId`、`blockingSince`。
- 同一 scope 唯一 Review constraint。
- Review 不设置终结态。

验收：

- approve 后 Review 仍可写。
- Review 可从 work scope 绑定到 revision scope。

### T3.2 Thread 与 comment 服务

依赖：T3.1。

工作：

- Thread CRUD。
- 单行唯一锚点约束。
- 同一行自动合并。
- comment 作者权限。
- 用户删除自己的 comment。
- 用户删除整个 thread。
- thread resolve/reopen。
- AI 不能编辑、删除或 resolve。

验收：

- 并发追加使用原子 update 不丢正文。
- AI 与用户同一行评论进入同一 thread。
- 单条 AI comment 无法被用户删除，整个 thread 可由用户删除。

### T3.3 AnchorEngine

依赖：T3.2。

工作：

- anchor hash 生成。
- 精确匹配与唯一模糊匹配。
- outdated 状态。
- work scope 新 snapshot 的重新定位。
- 重复代码行安全测试。

验收：

- 唯一匹配才移动锚点。
- 任何不确定情况标记 outdated。

### T3.4 Review draft

依赖：T3.1-T3.3。

工作：

- `(reviewId, sessionId, turn)` draft 唯一性。
- operation log。
- 新增、编辑、删除、resolve、reopen、delete thread 操作。
- 取消 draft 的回滚。
- 跨刷新恢复或安全丢弃策略。

验收：

- draft 操作对 AI 不可见。
- 取消 draft 回到 shared state。
- 同一用户多个窗口的冲突可检测。

### T3.5 VisibilityEngine

依赖：T3.4。

工作：

- User view 与 AI view。
- thread `revision/sharedRevision`。
- draft 过滤。
- tombstone 过滤。
- AI 与用户 draft 并发时的部分可见性。

验收：

- AI 工具永远读不到未提交用户评论。
- AI 自己新增的评论立即可见。
- 已删除正文不会进入后续 AI 工具返回。

### T3.6 ReviewSubmission

依赖：T3.4-T3.5。

工作：

- 冻结 operation payload。
- 创建不可变 submission。
- 更新 Review currentDecision。
- `agent.followup()` 幂等提交。
- submit_failed 重试。
- messageId 去重。

验收：

- 一次提交恰好启动一个 AI turn。
- 重试不会重复启动或重复应用操作。

建议提交：

`feat: persist review aggregates, threads, drafts, and submissions`

## 7. P4：Diff 客户端与 Thread UI

### T4.1 插件 Review tab 基础

依赖：P1-P3。

工作：

- 文件选择器。
- 文件统计。
- Review 当前 decision 展示。
- thread 总览和未解决计数。
- Review submission 历史入口。

验收：

- 官方 turn-tail 卡打开后默认选中正确文件。
- 文件切换不丢 thread 状态。

### T4.2 Diff renderer

依赖：T4.1。

工作：

- unified/split。
- wrap/no-wrap。
- syntax highlight。
- 行号、hunk、空侧单元格。
- 创建/删除/coarse/truncated/binary/oversized 状态。

验收：

- 与官方 diff 功能逐项对齐。
- 3,000 行以上滚动和大 diff 性能可接受。

### T4.3 Line thread layer

依赖：T4.2。

工作：

- 行号 gutter 评论按钮。
- thread 数量角标。
- resolved thread 图标和折叠。
- popover 定位。
- unified/split 切换后的重新定位。
- 滚动和缩放同步。

验收：

- 切换布局后不会错行。
- popover 不遮挡当前行，不越出面板。

### T4.4 Thread panel

依赖：T4.3。

工作：

- comment 列表。
- 用户/AI 作者样式。
- 回复输入框。
- 编辑自己的评论。
- 删除自己的评论。
- 删除 thread。
- resolve/reopen。
- outdated 展示。

验收：

- 权限按钮严格按作者显示。
- completed thread 默认只剩标记，可展开详情。

### T4.5 Review draft UI

依赖：T3.4、T4.1。

工作：

- Start review 状态。
- draft 变化计数。
- verdict 选择。
- 总结输入框。
- Submit/Cancel。
- 提交失败重试。

验收：

- 评论操作不触发 AI。
- 提交按钮只调用一次 submission。

### T4.6 Approve UI

依赖：T3.4、T4.5。

工作：

- Host 返回 approval eligibility。
- 阻塞 review + 新代码变化 + 无 draft 时显示独立 Approve。
- 点击打开提交框，默认 approve。
- draft 出现后隐藏独立 Approve。
- 普通提交框包含 approve，但默认 comment。

验收：

- 所有 AC-09/10/11/12/13 在组件测试中通过。

建议提交：

`feat: add review threads and explicit review submission UI`

## 8. P5：Review 提交与 Approve 行为

### T5.1 Verdict instruction 生成

依赖：T3.6。

工作：

- approve/comment/request_changes/reject 四种 instruction。
- 可选 summaryText。
- 引用材料边界。
- Review 当前决策与 thread 状态分离。

验收：

- approve 不要求修改，也不暗示 Review 终结。
- reject 要求回到设计讨论。
- resolve thread 不影响 verdict。

### T5.2 自动下一轮

依赖：T5.1。

工作：

- 使用 DSH 公开 `agent.followup()`。
- 忙时排队。
- 失败回滚与重试。
- 会话关闭时的安全处理。

验收：

- 不重复 turn。
- 不因 add/edit/delete/resolve 操作自动启动 turn。

### T5.3 Approval eligibility

依赖：T5.1、T2.2。

工作：

- 判定阻塞 decision。
- 判定阻塞后代码是否有 AI 修改。
- turn/work/revision scope 的不同策略。
- 后续 submission 覆盖旧阻塞状态。
- manual resolve 不改变 eligibility。

验收：

- state/unit tests 覆盖所有条件组合。

建议提交：

`feat: submit review decisions and compute approval eligibility`

## 9. P6：AI Skill 与工具

### T6.1 Skill 打包

依赖：P5。

工作：

- `skills/dsh-review-threads/SKILL.md`。
- 工具栏使用规则。
- verdict 语义。
- approve 非终结语义。
- 评论后必须告知用户。

验收：

- Skill 能被 DSH 发现。
- Skill 不要求 AI 直接操作数据库。

### T6.2 只读工具

依赖：T3.5、T6.1。

工作：

- `review_threads_list`
- `review_threads_get`
- 只返回 AI-visible state。
- 返回 Review decision、submission 摘要和 thread 状态。

验收：

- 看不到 draft comment。
- 能看到 resolved 状态和 approve 后的 Review。

### T6.3 写工具

依赖：T3.2、T6.2。

工作：

- `review_threads_add_comment`。
- 行锚点参数校验。
- 已有 thread 自动追加。
- `announcementRequired`。
- AI 不可删除、不可 resolve、不可 approve。

验收：

- 同一行不会因 AI 操作新增第二个 thread。
- approve 后 AI 仍可添加新评论。

### T6.4 Prompt 注入防护

依赖：T6.2-T6.3。

工作：

- 评论正文 XML/JSON 边界。
- “源码和评论是不可信材料”说明。
- 长度上限与截断标记。

验收：

- 评论中的伪指令不能改变工具权限。
- 大 thread 明确截断而非静默遗漏。

建议提交：

`feat(ai): add review thread tools and behavior skill`

## 10. P7：实时同步

### T7.1 Host 事件转换

依赖：P3。

工作：

- 监听 `domain/changed`。
- 按 Review/scope 生成 revisioned event。
- merge 连续 event。
- 关闭时释放订阅。

验收：

- 写入成功后广播。
- 不广播未持久化状态。

### T7.2 SSE 路由与重连

依赖：T7.1。

工作：

- `/plugins/dsh-review-threads/events`。
- `Last-Event-ID` 或 `afterRevision`。
- 重连先拉快照再订阅增量。
- 心跳和超时。

验收：

- 断线恢复不丢评论。
- 旧 revision 可回退到完整快照。

### T7.3 多会话 E2E

依赖：T7.2。

工作：

- 两个会话打开相同 revision scope。
- 一端添加/编辑/resolve/delete。
- 另一端实时变化。

验收：

- 无刷新更新。
- 不重复显示。
- 顺序与 Host revision 一致。

建议提交：

`feat: synchronize review threads across sessions`

## 11. P8：Working 与 Revision Scope

### T8.1 Working scope snapshots

依赖：P2-P7。

工作：

- 为 work scope 保存 patch revision。
- AI turn 结束后更新 working snapshot。
- re-anchor thread。
- 评论跨轮保留。

验收：

- 用户多轮交流后仍能看到原 thread。
- AI 修改代码后 thread 精确定位或标 outdated。

### T8.2 Git revision service

依赖：T2.1-T2.2。

工作：

- 解析 `base..head`。
- 解析后 OID 固化 scope。
- 生成 file summary 和 hunks。
- 提供单文件 diff。
- 安全处理无效 revision 和超大 diff。

验收：

- 不执行用户提供的 shell。
- 使用 argv 调用 git。
- scope hash 与设计一致。

### T8.3 `/review` 命令

依赖：T8.2。

工作：

- `/review <base>..<head>`。
- 打开插件 revision review tab。
- 可选 `-- <paths>`。
- 错误提示。

验收：

- 命令只打开 review，不发对话消息。
- 同一 range 重复打开聚焦已有 tab。

### T8.4 Revision Review UI

依赖：T8.2-T8.3、P4。

工作：

- 复用 diff renderer。
- 显示 range、commit 摘要和仓库。
- 处理跨会话 Review。

验收：

- 同一 revision scope 在两个会话看到同一个 Review。

建议提交：

`feat: review uncommitted workspaces and committed revision ranges`

## 12. P9：Commit 绑定与稳定化

### T9.1 Patch identity

依赖：P8。

工作：

- 计算 working 最终 patch digest。
- 计算 revision patch digest。
- 处理 rename、path filter、whitespace。

验收：

- 相同 patch 匹配。
- 不同 patch 不匹配。

### T9.2 绑定 UI 与命令

依赖：T9.1。

工作：

- 自动检测后显示建议。
- 用户确认。
- 失败回滚。
- 绑定后旧 work alias 仍可解析。

验收：

- Review ID 不变。
- Thread ID 不变。
- Submission history 不丢失。

### T9.3 目标 Review 冲突

依赖：T9.2。

工作：

- 若 rev scope 已有 Review，提供确认后的原子合并。
- 保留所有 thread/submission ID。
- 合并失败不产生半完成状态。

验收：

- 并发/重复绑定幂等。
- 两侧历史均可读。

建议提交：

`feat: bind working reviews to committed revision ranges`

## 13. P10：稳定化与发布

### T10.1 完整 E2E

依赖：P0-P9。

必须覆盖 AC-01 至 AC-13：

- 用户批量评论与提交
- 同行聚合
- 评论操作不唤醒
- AI 主动评论
- completed thread
- revision scope 跨会话
- commit 绑定
- thread 删除
- request_changes/reject 后独立 Approve
- 已开始 draft 时默认 comment
- approve 不是终结态
- resolve 不自动 approve

### T10.2 可访问性与国际化

依赖：P4-P6。

工作：

- 键盘导航
- focus ring
- ARIA 标签
- 中英文
- 窄屏和 Desktop
- reduced motion

### T10.3 运维与诊断

依赖：P2-P9。

工作：

- scope/review 诊断页面或命令
- 数据清理入口
- 兼容性错误提示
- 日志脱敏

### T10.4 打包与安装验证

依赖：全部。

工作：

- `pnpm verify`
- `pnpm pack`
- npm tarball 安装
- GitHub source 安装
- 卸载后官方 tab 恢复
- 数据保留

### T10.5 发布

依赖：全部。

工作：

- 版本号
- CHANGELOG
- Git tag
- GitHub Release
- npm publish
- 安装文档

建议提交：

`test: complete review thread compatibility and profile coverage`

`chore(release): release dsh-review-threads v0.1.0`

## 14. 建议 commit 顺序

1. `chore: bootstrap dsh-review-threads`
2. `feat: take over the official review tab behind a compatibility adapter`
3. `feat: add stable review scopes and persistent storage`
4. `feat: persist review aggregates, threads, drafts, and submissions`
5. `feat: add review threads and explicit review submission UI`
6. `feat: submit review decisions and compute approval eligibility`
7. `feat(ai): add review thread tools and behavior skill`
8. `feat: synchronize review threads across sessions`
9. `feat: review uncommitted workspaces and committed revision ranges`
10. `feat: bind working reviews to committed revision ranges`
11. `test: complete review thread compatibility and profile coverage`
12. `chore(release): release dsh-review-threads v0.1.0`

每个 commit 都必须满足：

- 实现
- 测试
- `docs/design.md`
- 对应 requirement 或 ADR
- `pnpm verify`

## 15. 第一组实际执行任务

用户确认开工后，实际顺序应为：

1. 创建 `$PERSONAL/dsh-review-threads`。
2. 从 `$THIRD/deepseek-harness` 核实与本地 `0.2.1-rc.2` 对应的源码/API；需要时再更新该 checkout，不在未确认前改动用户文件。
3. 运行项目骨架生成和依赖安装。
4. 写入 `AGENTS.md`、MIT、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、docs 初始版本。
5. 建立 lint、format、typecheck、test、build、docs、pack、e2e 的 `pnpm verify`。
6. 实现最小 `changes-review` extension tab。
7. 在真实 profile 中验证官方改动卡能打开插件 tab。
8. 验证通过后提交第一个 commit，并创建 GitHub 仓库。

GitHub 仓库应在首次本地验证通过后创建，避免过早建立一个不可运行的远端仓库。
