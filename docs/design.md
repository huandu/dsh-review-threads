# 技术方案

## 1. 总体方案

插件使用“官方 Review tab 接管 + Host 持久评论服务”的方式，而不是在官方 DOM 上做脆弱的按钮注入。

DSH 的 `ctx.sidebarRightTabs` 允许外部插件以 `extension` 优先级注册与 builtin 相同的 tab kind，并接管相同资源地址。因此 `dsh-review-threads` 可以注册自己的 `changes-review` tab 实现：

- 保留官方 `dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>` 地址。
- 继续由官方 turn-tail 修改文件卡打开。
- 继续从官方 `ctx.workspaceChanges` 读取本轮 diff。
- 重绘同一套文件选择、左右/统一 diff、自动换行、打开文件等功能。
- 在 diff 行之上叠加评论按钮、thread、review draft 和提交栏。

这样仍然“基于官方 diff 面板”，但拥有完整的 React 数据流和稳定的行级 DOM，不需要猜测官方 CSS 类名，也不会因为 React reconciliation 删除插件插入的节点。

## 2. 系统结构

```text
┌──────────────────────── DSH Web / Desktop ────────────────────────┐
│                                                                   │
│  official turn-tail card                                          │
│      │ dsh-resource://changes-review/...                          │
│      ▼                                                            │
│  dsh-review-threads Review tab (extension takes over builtin)     │
│      ├─ official-style diff renderer                              │
│      ├─ line comment buttons / thread popovers                    │
│      ├─ review draft toolbar                                      │
│      └─ realtime scope subscription                               │
│                    │ authenticated HTTP + SSE                     │
└────────────────────┼──────────────────────────────────────────────┘
                     ▼
┌──────────────────────────── DSH Host ─────────────────────────────┐
│ review-thread service                                             │
│  ├─ scope resolver: turn / working / revision                     │
│  ├─ anchor + re-anchor engine                                     │
│  ├─ review aggregate + draft/submission + visibility             │
│  ├─ approval eligibility engine                                   │
│  ├─ thread/comment repository                                     │
│  ├─ AI tools                                                      │
│  ├─ skill registration                                            │
│  └─ realtime event hub                                            │
│                    │                                              │
│                    ▼                                              │
│ ctx.storageDomain                                                 │
│  ├─ reviews                                                       │
│  ├─ review_ops                                                    │
│  ├─ threads                                                       │
│  ├─ scope_links                                                   │
│  └─ tombstones                                                    │
└───────────────────────────────────────────────────────────────────┘
```

## 3. Host 侧组件

### 3.1 ScopeResolver

负责把打开的面板映射为稳定 review scope。

#### Turn scope

由官方 Review tab 地址得到：

- `sessionId`
- `eventSeq`
- `turn`
- `workspaceChanges.summary(sessionId, eventSeq)`

再基于摘要中的所有文件路径、diff hunks 和 patch 内容计算 `patchDigest`。Turn scope key 建议为：

`turn:<sessionId>:<eventSeq>:<patchDigest>`

Turn scope 用于官方本轮改动卡片和当前会话上下文。它是范围最精确、最不会误绑定的 scope。

#### Working scope

用于同一会话内跨轮持续的未提交改动评审。键不能包含会随编辑变化的 patch digest，否则每次修改都会成为新 scope。建议：

`work:<repoIdentity>:<sessionId>:<baseOid>`

其中：

- `repoIdentity` 优先使用规范化 remote URL；没有 remote 时使用 Git common directory 的真实路径。
- `sessionId` 保证当前版本先只在本会话共享。
- `baseOid` 是创建 working scope 时的 HEAD commit。未初始化仓库可用空树 OID。

Working scope 内保存多个 snapshot revision。每个 thread 记录创建时的 snapshot revision，并通过 re-anchor 逻辑映射到最新 diff。

#### Revision scope

用于已提交变更，可跨会话共享：

`rev:<repoIdentity>:<baseOid>:<headOid>:<diffSpecDigest>`

`baseOid` 和 `headOid` 必须是解析后的 commit OID，不能使用会移动的 `main`、`HEAD` 等符号。`diffSpecDigest` 包含：

- 左右 commit OID
- merge-base 模式
- rename 检测
- whitespace 选项
- path filter
- diff context 行数
- diff 算法版本

最终 scope key 对外显示为 `sha256` 的短前缀，完整值保存在记录中。

### 3.2 AnchorEngine

一条 comment 的锚点至少包含：

| 字段               | 说明                                         |
| ------------------ | -------------------------------------------- |
| `path`             | 相对 Git 仓库根的文件路径                    |
| `side`             | `old` 或 `new`                               |
| `line`             | 该侧 1-based 结束行号；首版即唯一行号        |
| `startLine`        | 可选的连续评论起始行；首版始终与 `line` 相同 |
| `lineHash`         | 原行文本的 SHA-256                           |
| `beforeHash`       | 前一行文本哈希                               |
| `afterHash`        | 后一行文本哈希                               |
| `hunkHeader`       | 原 hunk 头部                                 |
| `hunkHash`         | hunk 内容哈希                                |
| `snapshotRevision` | 评论创建时的 diff snapshot                   |

重新锚定的顺序：

1. 文件与行号完全一致，且 `lineHash` 一致：精确命中。
2. 同一文件内搜索相同 `lineHash + beforeHash + afterHash`：唯一命中则恢复。
3. 同一文件同一 hunk 内搜索相同 hunk 签名：唯一命中则恢复。
4. 在全文件搜索 `lineHash`，仅唯一命中才恢复。
5. 全部失败：标记 `outdated`，保留原引用文本与 thread 内容。

不会做模糊语义匹配。宁可明确标记 outdated，也不把评论错误挂到另一行。

### 3.3 ReviewService

Review 是绑定一个 diff scope 的持久聚合。数据结构以 Review 为组，Thread 和 ReviewSubmission 均属于 Review。一个 Review 可以有多个 Thread，并拥有按时间排序的不可变 ReviewSubmission 历史。

Review 的核心规则：

- 同一 diff scope 在首版中只映射到一个 Review。
- Review 创建后不会因提交 verdict 而终结。
- `approve` 只更新 Review 的当前决策，之后仍可新增评论和再次提交。
- 手动 resolve thread 只改变 Thread 状态，不改变 Review 的当前决策。

每个 `(reviewId, sessionId, turn)` 至多有一个活跃的用户 review draft。这个 turn 指用户做 review 时所在的对话轮次，不等同于代码 diff 的 Turn scope。多个会话可以各自拥有 draft，但最终都更新同一个 Review。

用户新增评论会创建 draft；如果用户直接编辑、完成、重新打开或删除一个已共享 thread，也会创建 pending draft，使该状态变化能通过下一次 review 提交给 AI。仅在 draft 内创建后又删除、从未共享给 AI 的内容不需要提交。

draft 保存用户从开始 review 到提交之间的操作：

- `thread_created`
- `comment_added`
- `comment_edited`
- `comment_deleted`
- `thread_resolved`
- `thread_reopened`
- `thread_deleted`
- `review_verdict_changed`

在提交前，这些操作只改变本地可见状态，不进入 AI 工具结果，也不进入系统提示词。

提交时：

1. 冻结本次 review payload。
2. 在同一持久化流程中写入不可变 `review_submission`、operations 和每个 thread 的 shared revision。
3. 更新 Review 的 `currentDecision` 与 `lastSubmittedAt`。
4. `agent.followup()` 发起下一轮。
5. 若发起失败，标记该 submission 为 `submit_failed`，允许幂等重试。

已在同一 draft 中创建后又删除的内容不进入 AI payload，因为 AI 从未见过它。

### 3.4 ApprovalEligibilityService

独立 Approve 入口必须由 Host 计算，不能只由 Client 根据“看起来改过代码”猜测。

对每个 Review 维护最近一次已提交 submission：

- `currentDecision`
- `lastSubmittedAt`
- `lastSubmissionReviewId`
- `approvedByReviewId`

独立 Approve 可用的条件：

1. `currentDecision` 是 `request_changes` 或 `reject`。
2. 最近一次阻塞 submission 尚未被同一 Review 的后续 submission 覆盖。
3. 该次提交之后，同一 scope 出现了 AI 会话产生的代码变更。
4. 当前 `(sessionId, turn)` 没有活跃的 review draft。

代码变更以 Host 的确定性事实为准：

- Turn scope：该 Review tab 对应的 turn 之后存在新的 `workspace/changes` 事件。
- Work scope：本次阻塞 review 后，working diff 的 patch revision 增加。
- Revision scope：若 review 指向固定 revision，不自动出现 Approve，因为没有“之后的新修改”。该 scope 的批准只能通过普通 review 提交。

满足条件时，Client 在普通提交按钮的位置显示独立 Approve 按钮。点击它创建一个预填 `verdict=approve` 的提交对话框，但仍允许改为其他 verdict 并填写总结。该按钮表示批准整个 Review 的当前改动，不表示任何单个 Thread 已完成。

用户一旦添加任何 draft comment，独立 Approve 按钮隐藏，普通 Submit review 接管提交。普通 review 对话框始终包含 `approve`，但默认仍是 `comment`。

### 3.5 VisibilityEngine

系统区分两个视图：

- User view：thread 当前状态，包括未提交的 draft 操作。
- AI view：截至最近一次成功提交 review 的 shared state。

每条 thread 保存：

- `revision`：每次修改递增。
- `sharedRevision`：AI 最近可见的 revision。
- `pendingReviewId`：如果存在未提交修改。

`review_threads_list` 对 AI 默认只返回 shared state。提交 review 后，相关 thread 的 `sharedRevision` 提升到冻结值。

并发场景下，如果用户正在 draft 中评论某一行，AI 仍然可以给同一行追加评论。Host 按锚点找到同一 thread，并以原子 `update` 追加 AI comment；工具结果只返回 AI 自己的 comment id、锚点和 `announcementRequired`，不返回该 thread 中尚未提交的用户 draft 正文。这样既维持“一行一个 thread”，也不破坏用户 draft 对 AI 的不可见性。

删除整个 thread 后，记录降级为 tombstone：

- 正文、锚点与评论从普通读取中隐藏。
- 下一次 review payload 只发送 `thread_deleted` 和 thread id，不发送被删正文。
- 这是“未来不可见”；已经进入过模型上下文的内容无法撤销。

### 3.6 RealtimeHub

Host 监听持久化域的 `domain/changed`，按 scope key 向订阅的 Client 广播：

- `thread.created`
- `thread.updated`
- `thread.resolved`
- `thread.reopened`
- `thread.deleted`
- `comment.added`
- `comment.updated`
- `comment.deleted`
- `review.submitted`
- `review.decision_changed`
- `review.approval_available`
- `review.approval_withdrawn`

同一 Host 内多个会话可立即看到变化。连接断开后重新建立时，Client 先拉取 scope 快照，再订阅增量。

第一版不处理跨 Host 进程同步。

## 4. 持久化设计

使用 DSH 的 `ctx.storageDomain`，由用户 profile 已有的 storage backend 落到 `$DSH_HOME/storages`。这比插件私自定义 `~/.dsh-review-threads` 更符合 DSH 的用户数据约定，也自动尊重自定义 `$DSH_HOME`。

建议声明一个 `per-record` 域 `review_threads`，版本从 1 开始。

### 4.1 `scopes`

| 字段                      | 说明                                  |
| ------------------------- | ------------------------------------- |
| `scopeKey`                | 完整 scope key                        |
| `reviewId`                | 该 scope 解析到的唯一 Review          |
| `kind`                    | `turn`、`work`、`rev`                 |
| `repoIdentity`            | 仓库身份                              |
| `baseOid` / `headOid`     | Git 提交                              |
| `sessionId`               | working/turn scope 所属会话，可空     |
| `createdAt` / `updatedAt` | 时间                                  |
| `latestSnapshot`          | 最近一次 diff snapshot 摘要           |
| `boundRevisionScope`      | working scope 绑定后的 revision scope |

### 4.2 `threads`

| 字段                      | 说明                                    |
| ------------------------- | --------------------------------------- |
| `threadId`                | UUID                                    |
| `reviewId`                | 所属 Review                             |
| `scopeKeyAtCreation`      | 创建时的 diff scope，用于审计和绑定迁移 |
| `anchor`                  | 上述 AnchorEngine 字段                  |
| `status`                  | `open`、`resolved`、`outdated`          |
| `revision`                | thread 当前版本                         |
| `sharedRevision`          | AI 可见版本                             |
| `createdBy`               | `user` 或 `agent`                       |
| `createdAt` / `updatedAt` | 时间                                    |
| `comments`                | 评论数组，按时间排序                    |

评论数组存放在 thread 记录内。评论数量通常较小，单记录原子更新足以保证并发追加不丢失。超出性能上限后，v2 再拆为独立 comment 记录。

### 4.3 `reviews`

| 字段                      | 说明                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `reviewId`                | UUID                                                                                           |
| `activeScopeKey`          | 当前绑定的 diff scope                                                                          |
| `currentDecision`         | 最近一次成功 submission 的 `approve`、`comment`、`request_changes` 或 `reject`；尚未提交时为空 |
| `blockingSince`           | 最近一次进入 request_changes/reject 的时间                                                     |
| `lastSubmittedAt`         | 最近一次成功 submission 时间                                                                   |
| `latestSubmissionId`      | 最近一次 submission                                                                            |
| `createdAt` / `updatedAt` | 时间                                                                                           |

Review 没有 `approved`、`done` 或 `closed` 终结态。`currentDecision=approve` 只表示当前接受，Review 仍可继续写入。

### 4.4 `review_submissions`

| 字段                        | 说明                                              |
| --------------------------- | ------------------------------------------------- |
| `submissionId`              | UUID                                              |
| `reviewId`                  | 所属 Review                                       |
| `sessionId` / `turn`        | 发起本次 submission 的会话和对话轮次              |
| `verdict`                   | `approve`、`comment`、`request_changes`、`reject` |
| `summaryText`               | 可选整体总结                                      |
| `operations`                | 冻结的评论/thread 状态变化                        |
| `state`                     | `submitting`、`submitted`、`submit_failed`        |
| `messageId`                 | 对应下一轮 user message 的身份                    |
| `createdAt` / `submittedAt` | 时间                                              |

ReviewSubmission 一旦成功即不可修改。更正通过下一次 submission 表达。

### 4.5 `review_drafts`

| 字段                      | 说明                                            |
| ------------------------- | ----------------------------------------------- |
| `reviewId`                | 所属 Review                                     |
| `sessionId` / `turn`      | draft 所属会话和轮次                            |
| `verdict`                 | 默认 `comment`；独立 Approve 流程默认 `approve` |
| `summaryText`             | 用户输入中的整体总结                            |
| `operations`              | 尚未共享的操作列表                              |
| `createdAt` / `updatedAt` | 时间                                            |

### 4.6 `bindings`

保存 working scope 与 revision scope 的绑定关系。绑定后：

- working thread 继承到 revision scope。
- 原 thread id 保持，不复制成第二条讨论。
- 原 reviewId 保持。
- 旧 working scope 与 revision scope 都解析到同一个 Review。
- 后续会话打开 revision scope 会看到它。

如果目标 revision scope 已存在 Review，绑定需要把 working Review 的 thread、submission 和 draft 原子合并到目标 Review；首版默认需要用户确认。thread ID 和 submission history 不允许重新生成。

## 5. Review 与 Thread 状态机

### 5.1 Review 聚合

Review 始终存在并保持可写。唯一变化的是 `currentDecision`：

```text
none ──comment──► comment ──request_changes──► request_changes
  │                  │                           │
  │                  ├────────reject────────────►reject
  │                  ├────────approve───────────►approve
  │                  │                           │
  └──────────────────┴───────────────────────────┘
                任意 verdict 后可继续
                新增 thread/comment 并发起下一次 submission
```

`approve` 不是终结节点。任何 verdict 都不会阻止用户或 AI 继续添加评论，也不会自动完成 thread。

手动 resolve thread 只更新 thread 状态，不改变 `currentDecision`。所有 thread 都 resolved 时，Review 也不会自动变成 `approve`。

### 5.2 Review draft

```text
idle
  ├─ 用户添加第一条 draft comment ──► draft
  ├─ 阻塞 review 后代码已修改 ─────► approval_available
  │                                      │
  │                                      ├─ 点击 Approve ──► submitting(approve)
  │                                      └─ 用户添加评论 ──► draft(默认 comment)
  │
  ▼
draft ──用户修改任意评论/thread────────┐
  │                                   │
  ├───────────────────────────────────┘
  │ 提交 review
  ▼
submitting
  ├─ 持久化失败 ──► submit_failed ──重试──► submitting
  └─ 成功
       ▼
   submitted
       │
       └─ 更新 lastVerdict 并 Host 发起下一轮
```

取消 draft 是独立操作，默认要求确认。取消后：

- draft 内新建的评论、thread 及其操作回滚到开始 review 前的状态。
- 对已共享 thread 的修改恢复为 shared state。

### 5.3 Thread

```text
open ──用户完成──► resolved
  ▲                  │
  └──用户重新打开────┘

open/resolved ──用户删除──► tombstoned

open/resolved ──找不到锚点──► outdated
outdated ──重新定位成功──► open/resolved
```

AI 的写操作：

```text
无 thread ──AI 新增首条评论──► open
open ──AI 追加评论──► open（revision + 1）
resolved ──AI 写评论──► 默认拒绝
tombstoned ──AI 写评论──► 拒绝
```

## 6. AI 集成

### 6.1 Bundled Skill

Skill 名称建议：`dsh-review-threads`。

触发场景：

- 用户要求 review 当前分支、工作区或某轮改动。
- AI 在实现中发现必须由用户确认的取舍。
- 用户提交了一个 review，AI 需要处理 thread。

AI 行为约束：

1. 评论是给用户看的补充上下文，不是把所有决策都移出最终回复。
2. AI 新增评论后必须在当前对话中告知用户。
3. AI 只能通过工具新增评论。
4. AI 不能声称 thread 已完成；只有用户能完成。
5. `approve` 表示用户接受当前修改；`comment` 只讨论；`request_changes` 必须修改；`reject` 停止局部修改并回到设计层面。
6. 收到 `approve` 时，不要求继续修改，但必须确认已收到批准并回应可选总结。
7. `approve` 不结束 Review。批准后仍可在新 thread 或 open thread 中添加评论；AI 不得把 approve 当作禁止继续讨论的信号。

### 6.2 模型工具

#### `review_threads_list`

只读。返回当前会话可访问的 scope 摘要和 thread，默认只返回 shared state。

参数：

- `scopeKey?`
- `status?`：`open`、`resolved`、`outdated`、`all`
- `path?`
- `sinceRevision?`

返回：

- scope 身份与 kind
- reviewId、当前 decision、最近 submission 摘要
- thread id、状态、锚点、评论摘要
- `lastSubmittedReviewId`
- 未解决阻塞项数量

#### `review_threads_get`

只读。按 `threadId` 返回完整 thread 与评论。

#### `review_threads_add_comment`

写入。参数：

- `scopeKey`
- `threadId?`
- 新建 thread 时必填 `path`、`side`、`line`、`expectedLineHash`
- `body`

行为：

- 有 `threadId`：向现有 thread 追加。
- 无 `threadId`：根据锚点寻找同一行 thread；存在则追加，不存在则创建。
- 成功后返回 `threadId`、`commentId`、位置摘要和 `announcementRequired: true`。
- AI 工具本身不会创建用户消息，也不会启动新 turn。

不提供 AI 可调用的编辑、删除、resolve、reject 或 approve 工具。

### 6.3 Review 提交消息

提交 review 后生成一条 plugin-sourced user/followup message。内容结构稳定，不依赖模型自行拼接：

```text
<review_submission review_id="..." verdict="approve|comment|request_changes|reject" scope="...">
  <instruction>...</instruction>
  <summary>用户填写的可选整体总结</summary>
  <thread_changes>
    <thread id="..." status="open|resolved|outdated|deleted">
      <anchor path="src/a.ts" side="new" line="42" ... />
      <comment author="user" operation="added|edited">...</comment>
      <comment author="agent" operation="context">...</comment>
    </thread>
  </thread_changes>
</review_submission>
```

评论正文按引用材料处理，并进行边界转义。`instruction` 根据 verdict 生成。

## 7. Client UI

### 7.1 Review tab

接管 `changes-review` 后保留官方基本结构：

- 顶部文件选择器
- 文件增删统计
- 左右/统一视图切换
- 自动换行
- 打开整个文件

新增：

- review draft 状态胶囊
- 当前 scope 的 thread 总览按钮
- 未解决 thread 数
- Review 当前决策与 submission 历史入口
- Start review / Submit review 入口
- 阻塞 review 且代码已修改时的独立 Approve 按钮
- Completed thread 折叠区

### 7.2 行内入口

每个可评论的 diff 行在行号区域显示评论按钮：

- 无 thread：悬停时显示 `+` 或评论图标。
- 已有 thread：始终显示数量角标。
- completed thread：显示完成图标，默认不显示评论正文。

点击按钮打开锚定到该行的浮动 thread 面板。面板不挤压 diff 行高；滚动、窗格 resize 或切换统一/左右视图时重新计算位置。

### 7.3 Thread 面板

内容顺序：

1. 路径、side、line、outdated 状态
2. 评论列表
3. 回复输入框
4. 用户操作：完成/重新打开、删除 thread

单条评论：

- user own comment：编辑、删除
- AI comment：只读
- 已被删除：显示删除占位，不显示正文

### 7.4 Review 提交栏

第一条用户 draft comment 出现后显示：

- “评审进行中”
- draft 评论变化数量
- verdict 选择器
- 可选整体总结输入框
- Submit review
- Cancel review

普通 review 的默认 verdict 为 `comment`。`approve`、`request_changes` 和 `reject` 使用明确文案解释 AI 后续行为。

当阻塞 review 后代码已经修改，且没有活跃 draft 时，在同一位置显示独立 Approve 按钮。点击后打开同一提交对话框，默认 verdict 为 `approve`。用户添加任意 draft comment 后，独立 Approve 立即隐藏，改用普通 Submit review，默认 verdict 回到 `comment`。

## 8. 通信与 API

所有路由注册在 DSH Connection 的认证围栏内。

| 方法 | 路由                                               | 用途                                            |
| ---- | -------------------------------------------------- | ----------------------------------------------- |
| GET  | `/api/plugins/dsh-review-threads/changes.summary`  | 官方 turn scope 文件摘要                        |
| GET  | `/api/plugins/dsh-review-threads/changes.diff`     | 官方 turn scope 单文件 diff                     |
| GET  | `/api/plugins/dsh-review-threads/revision.summary` | working 或 revision scope 文件摘要              |
| GET  | `/api/plugins/dsh-review-threads/revision.diff`    | working 或 revision scope 单文件 diff           |
| GET  | `/api/plugins/dsh-review-threads/review`           | Review 聚合、thread、draft、决策和 scope 元数据 |
| POST | `/api/plugins/dsh-review-threads/action`           | thread/comment/draft/submit 操作                |
| GET  | `/api/plugins/dsh-review-threads/events`           | SSE 增量                                        |

服务端对 `author` 不信任请求体，用户请求一律记为 owner user；AI 请求只通过模型工具进入。

`/review` 命令在 Host 侧解析参数并解析 Git commit OID，再把
`dsh-resource://changes-review/work/...` 或
`dsh-resource://changes-review/revision/...` 地址交给 Client 自动打开。
命令结果本身是轻量协议文本，不启动对话回合。working scope 每次刷新都会计算
patch digest，并以当前 diff 行为候选重新锚定开放的 thread；无法唯一恢复的
thread 标为 outdated，正文与历史不删除。revision scope 以解析后的 OID 和
diff options 生成稳定 key，因此不同会话打开同一区间会落到同一个 Review。

## 9. Commit 绑定

Working scope 转成 revision scope 分两步：

1. 用户提交代码后，插件的 `/review bind` 命令或 UI 按钮读取提交的 `baseOid`、`headOid` 和 patch digest。
2. 如果 working scope 的最终 patch digest 与 revision diff 一致，显示可绑定提示；用户确认后写入 bindings，更新 Review 的 `activeScopeKey`，并让旧 working scope 与 revision scope 都解析到同一 Review。

若 patch 不一致，不自动绑定，只允许手工选择一个 revision scope。绑定过程必须原子完成，避免部分 thread 卡在两个 scope。

## 10. 兼容性与降级

- 启动时检查官方 `changes-review` tab 是否存在。
- 若官方地址契约或 `workspaceChanges` 不匹配，插件不接管 tab，并在设置页给出兼容性错误。
- 若 revision diff 可用但官方 Turn snapshot 已丢失，revision review 仍可工作。
- 若 thread 锚点不可恢复，显示 outdated thread 列表，不丢弃评论。
- 若 SSE 断开，面板保留快照并自动重连；不把断线视为数据丢失。

## 11. 权限与数据边界

- 用户可以删除自己的单条评论。
- 用户不能删除 AI 的单条评论。
- 用户始终可以删除整个 thread，包括其中 AI 评论。
- AI 只能新增评论。
- 删除 thread 会把普通读取中的内容移除，并保留无正文 tombstone 用于通知 AI 该对象已删除。
- 所有评论都视为不可信输入；进入模型时必须标注为引用材料。

## 12. 建议的首版范围

首版必须完成：

- 接管官方 `changes-review` tab 并保留官方 diff 能力
- 用户行级评论、thread、review draft、四种 verdict 与独立 Approve
- 评论操作不唤醒 AI，提交 review 自动发起下一轮
- AI 评论工具与 bundled Skill
- turn scope 与 working scope 持久化
- 单 Host 多会话实时同步
- revision scope 手工打开与跨会话共享

首版暂缓：

- working scope 自动提交绑定
- GitHub/GitLab 同步
- 多行选区评论
- side-by-side 以外的图片 diff 评论
- comment suggestion 直接应用
- 跨 Host 进程通知
