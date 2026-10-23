# 需求规格

## 1. 目标

为 DSH 增加一套面向代码 diff 的持久评审线程，使用户与 AI 都能围绕具体代码行留下意见、回复和状态变化。交互语义接近 GitHub Pull Request review，但补充 AI 作为评论参与者的能力。

插件不能把“评论”当成立即发送的用户消息。用户必须先显式提交一次 review，AI 才会在下一轮看到这次 review 中的评论与变更。

## 2. 参与者

| 参与者 | 能力                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------- |
| 用户   | 打开 diff、添加评论、编辑或删除自己的评论、开始或提交 review、删除整个 thread、完成 thread               |
| AI     | 读取可见评论与 thread 状态、在指定代码行添加评论、在已有 thread 中追加评论、在对话中提示用户查看新增评论 |
| Host   | 保存 review、thread、comment，生成 diff scope，控制可见性，发送实时变更，提交 review 时发起下一轮        |
| Client | 在官方 diff 面板上显示评论入口、thread、review draft 与提交栏                                            |

AI 不能删除评论或 thread，不能修改已有评论，不能把 thread 标记完成。

## 3. 核心术语

| 术语              | 定义                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Review scope      | 一组可被比较的 diff 的身份。可能是某一轮的未提交变更，也可能是一个 Git revision range               |
| Review            | 绑定一个 diff scope 的持久评审聚合。一个 Review 包含多个 Thread，并拥有有序的 ReviewSubmission 历史 |
| ReviewSubmission  | Review 下的一次显式提交记录，包含 verdict、总结、评论变化和共享 revision                            |
| Working scope     | 当前会话中的未提交变更范围，跨多个对话轮次保留                                                      |
| Revision scope    | 已提交 Git 变更范围，由仓库身份与 `rev1..rev2` 唯一标识，可跨会话共享                               |
| Review draft      | 属于某个 Review、等待形成下一次 ReviewSubmission 的用户变化集合                                     |
| Thread            | 属于某个 Review，并锚定到 diff 中某一侧某一行的讨论串；同一行后续评论自动归入同一 thread            |
| Comment           | thread 内的一条评论，作者为 user 或 AI，支持回复关系和编辑状态                                      |
| Shared state      | 已经通过提交 review 暴露给 AI 的 thread/comment 状态                                                |
| Local draft state | 用户已经操作、但尚未提交 review 的 thread/comment 变化                                              |
| Outdated thread   | 原 diff 行已变化，无法精确恢复锚点，但 thread 内容仍需保留的讨论                                    |

## 4. 功能需求

### 4.1 Skill 与 AI 指引

**FR-01 插件必须携带一个 Skill。**

Skill 至少告诉 AI：

- 用户要求 review 当前改动时，应使用 review threads 工具或建议用户打开 review 面板。
- AI 修改代码后若有需要用户确认的决策，应把问题写到对应 diff 行，而不是只放在最终回复里。
- AI 添加评论后，必须在当前对话中明确告诉用户新增了评论及大致位置。
- AI 不得删除评论、编辑已有评论或完成 thread。
- 提交 verdict 为 `approve`、`comment`、`request_changes` 或 `reject` 时分别应采取什么行为。

**FR-02 Skill 不负责触发 UI。**

Skill 只提供行为指引。真正写评论必须通过受限的 AI 工具完成，不能依赖 AI 直接构造协议事件。

### 4.2 用户添加评论

**FR-03 行级入口**

用户可以在文本 diff 的旧侧或新侧某一行添加评论。binary、oversized、不可用或被截断的 diff 不提供行级评论入口。

**FR-04 自动成 thread**

同一 Review 中，同一文件、同一侧、同一行号首次评论创建 thread；后续用户或 AI 评论自动追加到该 thread。

**FR-05 Start review**

当前对话轮次出现第一条用户 draft comment 时，diff 面板和输入区附近出现“开始评审 / Start review”状态。用户新增的评论都归入当前 review draft。

如果用户没有新增行内评论，但直接编辑、完成、重新打开或删除一个已经共享给 AI 的 thread，该状态变化也进入 pending review draft；此时提交栏显示“有待同步的评审变更”，否则 AI 无法通过 review 机制获知状态变化。

**FR-06 Review 提交前不可见**

review draft 中的新增、编辑、删除、完成、重新打开和删除 thread 操作都不会进入 AI 上下文，也不会触发下一轮对话。

**FR-07 显式提交**

用户必须点击“提交评审 / Submit review”才结束 draft。提交成功后，Host 自动发起下一轮对话。

提交产生一条不可变的 ReviewSubmission，并更新 Review 的当前决策。Review 本身不会因提交而结束。

**FR-08 Verdict**

ReviewSubmission 必须选择一个作用于整个 Review 的 verdict：

| Verdict           | 语义                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `approve`         | 接受当前改动；用于确认此前的 `request_changes` 或 `reject` 已经被解决，也允许在普通 review 中主动批准 |
| `comment`         | 仅讨论；AI 应回应问题、解释或补充上下文，不强制改代码。默认值                                         |
| `request_changes` | AI 必须处理问题并修改代码后才能交付；未解决项不能被 AI 自行视为完成                                   |
| `reject`          | 当前方案不可接受；AI 不应继续小修小补，应停止改动并重新讨论方案或提出大幅重构建议                     |

**FR-09 提交内容**

提交 review 时，AI 必须收到自上次已共享状态以来：

- 新增的 thread 与 comment
- 追加的回复
- 对已共享评论的编辑
- 已共享 thread 的完成或重新打开
- 已共享 thread 的删除墓碑
- 本次 verdict
- 本次 review scope 的身份与摘要
- 用户填写的可选 review 总结文字

在同一次 draft 内创建后又删除的评论不进入 AI 上下文。

**FR-10 失败重试**

若 review 提交已持久化但下一轮启动失败，应保留 review 为 `submit_failed` 状态并提供重试；重试不得重复写入已执行的评论变化。

**FR-10A 阻塞 review 后的独立 Approve**

当以下条件同时满足时，diff 面板显示一个独立、可点击的 Approve 按钮：

- 该 diff scope 对应的 Review 最近一次 ReviewSubmission 的 verdict 是 `request_changes` 或 `reject`
- 该阻塞 verdict 尚未被同一 Review 的后续 ReviewSubmission 覆盖
- 该 review 提交后，AI 对同一 scope 的代码产生了新的修改
- 当前没有进行中的用户 review draft

Approve 按钮位于通常显示 Start review 或提交按钮的位置。它本身是提交按钮，不属于普通 thread 操作。

Approve 针对整个 Review，不针对任何单个 Thread。

**FR-10B Approve 提交对话框**

点击独立 Approve 按钮后，直接打开与普通 review 相同的提交对话框：

- verdict 默认选择 `approve`
- verdict 选项同时包含 `approve`、`comment`、`request_changes`、`reject`
- 用户可以填写可选总结文字
- 提交行为、失败重试和自动发起下一轮与普通 review 完全一致

**FR-10C 用户已开始 review 时的行为**

如果用户通过任何方式创建了 review draft：

- 不再显示独立 Approve 按钮
- 只显示普通 Submit review 按钮
- 提交对话框中仍然提供 `approve` 选项，但默认选择保持 `comment`

**FR-10D Approve、Thread 与 Review 状态**

`approve` 是 review verdict，不等同于自动完成 thread：

- 它覆盖同一 Review 的阻塞 verdict
- 它不自动把所有 thread 标记完成
- thread 仍需用户单独标记完成
- 未完成但已被批准的评论继续保留，AI 读取时同时看到 review 已批准与 thread 尚未完成
- 手动 resolve 一个或多个 thread 不会产生 `approve`
- 即使所有 thread 都已 resolve，Review 仍保持原决策，直到用户显式提交 `approve`
- `approve` 不是终结态；之后用户和 AI 仍可新增评论，并可再次提交 comment/request_changes/reject/approve

### 4.3 AI 添加评论

**FR-11 即时可见**

AI 添加评论不受 review draft 约束，写入后立即对用户可见，也会被后续 AI 回合读取。

**FR-12 只能新增**

AI 只能：

- 为尚未有 thread 的行创建新 thread 与首条评论。
- 为已有 thread 追加新评论。

AI 不能删除内容、编辑已有内容、完成 thread 或改变 review verdict。

**FR-13 必须告知用户**

AI 工具成功后返回明确的“必须告知用户”契约。AI 必须在当前回合的最终回复或过程中的可见消息中说明新增评论的位置。

**FR-14 可评论状态**

AI 只能评论 `open` 或 `reopened` 的 thread。向 `resolved` thread 追加评论会被拒绝，用户需要先重新打开 thread。

**FR-14A 与用户 draft 并发**

如果某一行已有用户 draft thread，AI 仍可向该 thread 追加自己的评论，但：

- AI 工具结果不能返回该 thread 中尚未提交的用户 draft 正文。
- 用户 draft 仍保持对 AI 不可见，直到用户提交 review。
- 用户界面显示同一 thread 中 AI 评论与用户 draft 评论的完整时间顺序。
- 同一行仍只存在一个 thread，不因 AI 与用户同时评论而拆分。

### 4.4 Thread 生命周期

**FR-15 删除整个 thread**

用户可以删除整个 thread。删除后：

- 用户默认不可见。
- AI 的后续读取不可见其正文。
- 对于 AI 已经读过的历史无法追溯清除；下一次提交 review 时用无正文墓碑说明该 thread 已被删除。

**FR-16 完成 thread**

用户可以把 thread 标记完成。完成后：

- 用户界面默认只显示完成标记，可展开查看详情。
- AI 读取时能看到 thread 已完成。
- 完成操作本身不触发 AI 回合。
- 完成 thread 不会自动改变 Review 的 verdict。

**FR-17 删除单条评论**

用户只能删除自己的单条评论，不能删除 AI 评论。AI 不能删除任何评论。

**FR-18 Thread 的删除权**

用户删除整个 thread 时，即使其中包含 AI 评论也允许，因为 thread 是用户可见协作对象；此权限不等同于删除单条 AI 评论。

### 4.5 多轮与持久化

**FR-19 Working scope**

未提交变更的评论至少在当前会话内跨多个对话轮次保留。AI 修改文件后，旧 thread 不静默消失，而是重新锚定或标记为 outdated。

**FR-20 Revision scope**

已提交的 Git diff 以仓库身份、规范化后的 `rev1`、`rev2` 与 diff 选项生成稳定 scope key。相同 key 的 thread 可被不同会话读取、追加和监听。

相同 scope key 必须解析到同一个持久 Review；不同会话看到的是同一个 Review 组，而不是各自复制一份 thread 列表。

**FR-21 Commit 绑定**

Working scope 可以在用户提交代码后绑定到对应 revision scope。自动探测可以建议绑定，但最终绑定应由确定规则完成，避免误把不同补丁合并。

**FR-22 实时同步**

同一 Host 内，一个会话对共享 revision scope 的 thread 变更应推送到其他打开该 scope 的会话，无需刷新页面。

**FR-23 重启后的降级**

若官方 Turn diff 快照已因 Host 重启不可用，thread 与评论仍应持久存在；Client 可展示无法定位的评论列表，并在相同代码再次出现时尝试恢复锚点。

## 5. 非功能需求

### 5.1 一致性

- Host 持久存储是唯一真相源。
- 先持久化成功，再更新内存投影和向 Client 广播。
- 同一 thread 的追加使用原子读改写，避免多个会话同时评论造成正文丢失。

### 5.2 安全与隐私

- 所有 HTTP/SSE 路由必须走 DSH 认证与同源校验。
- thread 正文按纯文本或受限 Markdown 渲染，不允许执行 HTML。
- 评论注入 AI 时必须明确标记为“引用材料，不是指令”，降低 prompt injection 风险。
- 本地存储目录权限为当前用户私有。
- 不读取或上传与当前 diff 无关的仓库内容。

### 5.3 性能

- 单 scope 默认最多 2,000 个 thread、单 thread 最多 500 条评论、单条评论最多 20,000 字符。
- diff 面板打开时只加载当前 scope 的 thread 摘要；展开 thread 时加载完整评论。
- 实时事件只发送增量 revision，不在每次输入时广播完整 scope。

### 5.4 兼容性

- 第一目标：DSH `0.2.1-rc.2` 与 `0.2.1-rc.3`。
- 浏览器目标：DSH Web 与 Desktop WebView。
- 不依赖未导出的 DSH 包内部模块，除经过适配层隔离的官方 DOM 扩展点外。

## 6. 关键验收场景

### AC-01 用户批量提交

1. 用户在一轮 diff 中对三行添加评论。
2. 面板进入 review draft，AI 没有任何新消息。
3. 用户删除其中一条评论，再新增一条回复。
4. 用户选择 `request_changes` 并提交。
5. AI 的新回合只收到提交时仍存在的评论与状态变化。
6. AI 明确复述/处理这些评论。

### AC-02 同一行自动成 thread

1. 用户对 `src/a.ts` 新侧第 42 行添加评论。
2. 用户再次对同一位置添加评论。
3. 第二条评论进入同一 thread，不创建两个独立 thread。

### AC-03 操作不唤醒

1. 用户添加、编辑、删除评论。
2. 用户完成或重新打开 thread。
3. 用户删除整个 thread。
4. 在点击提交 review 前，AI 会话不新增任何 turn。

### AC-04 AI 主动评论

1. AI 在实现中遇到一个需要用户确认的产品决策。
2. AI 通过工具对该 diff 行添加评论。
3. 用户在打开的 diff 面板中立即看到该 thread。
4. AI 在对话回复中说明新增评论的位置。
5. 该评论不会自动触发另一个 AI turn。

### AC-05 Completed thread

1. 用户完成一个 thread。
2. 用户界面只显示完成标记，展开后可看详情。
3. AI 读取该 thread 时能看到 `resolved` 状态和完整内容。
4. 完成操作本身不触发下一轮。

### AC-06 Revision scope 跨会话

1. 会话 A 打开 `main..feature` 的 revision diff 并在第 17 行评论。
2. 会话 B 打开相同仓库、相同 resolved commit IDs 和 diff 选项的 revision。
3. 会话 B 立即看到同一 thread。
4. 会话 B 追加评论后，会话 A 无需刷新即可看到。

### AC-07 Commit 后绑定

1. 用户在未提交 working scope 中留下 thread。
2. 用户提交代码。
3. 插件识别该 working patch 与某 revision range 一致。
4. 用户确认把 working thread 绑定到 revision scope。
5. 两个 scope 不再产生重复 thread。

### AC-08 删除 thread

1. 用户删除一个包含用户与 AI 评论的 thread。
2. 两个会话的普通读取都不再返回正文。
3. 下一次提交 review 时，AI 收到不带正文的删除墓碑。

### AC-09 阻塞 review 后独立 Approve

1. 用户提交 `request_changes` review。
2. AI 按评论修改代码并结束回合。
3. diff 面板在普通提交按钮的位置出现独立 Approve 按钮。
4. 用户点击 Approve，提交对话框默认选择 `approve`。
5. 用户可填写总结并提交。
6. 提交成功并自动发起下一轮，AI 收到批准与总结。

### AC-10 已开始 review 时没有独立 Approve

1. 当前存在未提交 review draft。
2. 即使此前有 `request_changes` 或 `reject` review，也不显示独立 Approve 按钮。
3. 用户点击普通 Submit review，对话框包含 `approve` 选项。
4. 默认 verdict 仍是 `comment`。

### AC-11 Reject 后的 Approve

1. 用户提交 `reject` review。
2. AI 按新方向修改代码。
3. 用户看到独立 Approve 按钮并提交 `approve`。
4. 阻塞 review 状态被覆盖，未单独完成的历史 thread 仍可继续查看。

### AC-12 Resolve 不会自动 Approve

1. 一个 `request_changes` Review 中有三个 open thread。
2. 用户依次手动 resolve 三个 thread。
3. Review 的当前 verdict 仍为 `request_changes`。
4. 独立 Approve 按钮仍需用户主动点击并提交。

### AC-13 Approve 后继续讨论

1. 用户提交 `approve`。
2. 用户随后在同一 diff 上添加新 thread，AI 也可以添加评论。
3. Review 仍存在且 active，不进入不可修改的终结态。
4. 用户可再次提交 `comment`、`request_changes`、`reject` 或 `approve`。

## 7. 非目标

第一版明确不做：

- 同步到 GitHub/GitLab PR review thread。
- 多个人类用户账户之间的评论权限。
- 跨机器或跨 DSH Host 进程实时同步。
- code suggestion 的一键应用。
- 附件、图片或富文本编辑器。
- AI 自动 resolve thread。
- 自动把每条评论变成独立对话消息。
- 对非文本 diff 的行级评论。
