# 原始需求记录

本文件保存用户的原始需求与后续明确反馈，后续实现仓库应迁移为 `docs/requirements/original.md`。规范化解释见 [01-requirements.md](01-requirements.md)。

## 首轮需求

基于前面的研究结果，倾向于基于官方的 diff 面板，在面板上实现 GitHub PR 的 code review 类似的评论功能的插件，名字帮我起一下。

具体而言，需要包括以下的功能：

- 插件可以通过 skill 告诉 AI，如果对于 diff 本身有一些平台（例如，用户需要对当前分支代码进行 review，可以将 review 意见提交到 diff 里；还可以是 AI 主动写的代码，如果有一些有待用户确认的地方，直接在 diff 里追加评论，方便用户知道上下文）
- 用户可以在 diff 面板里添加评论
  - 用户或者 AI 可以在 diff 的某一行，添加 comment，后续在同一行添加 comment 的时候，会自动的变成一个讨论串（comment thread），聚合在一起
  - 对于一轮对话而言，一旦用户添加第一条评论，就可以额外出现一个类似 Github PR code review 的功能，提示用户 start review，这时所有用户这次追加的 comment 都会放在这次 review 里面，用户必须提交 review 才能让这次的所有 comment 被看到
  - 用户 start review 后，这次添加评论本身并不能直接被 AI 看到，添加、删除、修改、标记完成等任何的 comment 操作都不会立即触发下一轮对话，直到用户提交 review，就可以自动触发下一轮对话；触发下一轮对话时，AI 需要直到这次所有的 comment 变化信息，以方便知道用户这次的意图
  - 用户可以在提交 review 的时候，选择这次 review 是 comment（仅讨论，这是默认值）、ask for change（必须修改才能交付）或者 reject（完全不行，存在重大问题，应该考虑大幅修改，甚至重新讨论设计方案）
  - AI 添加评论则不存在 start review 的概念，随时可以添加；AI 只允许添加新的评论，添加后必须在会话中告诉用户这个情况，以便用户知道并去阅读；AI 不允许删除 comment 或者标记 comment thread 为完成
- 这些 diff 中的 comment 可以在多轮对话中保留，与本地的 git commit 可以实现绑定
  - 如果 diff 是未提交的变更，在当前对话中存储 comment 信息，确保当前对话中多轮交流都能持续的看到这些 diff 与对应的 comment，做到用户和 AI 可以反复的在 diff 中进行不断的追加讨论
  - 如果 diff 是已经提交的 git 变更，那么以 git repo + revision diff（`rev1..rev2`）做一个 hash，在本地的缓存目录（例如 `~/.{plugin-dir}` 里面）缓存所有的 comment thread，确保后续针对这个 diff 的所有 comment thread 能够持续的被读取和继续讨论；不同会话都能读取或写入这些 thread 信息，只要 hash 一致就可以；如果其他会话中修改了某个 comment thread 信息（比如追加了一些 comment），在这个会话中会立即发生变化（监听 comment thread 变化）
- 对于 diff 中的 comment thread 而言，用户可以直接做一些操作
  - 可以删除整个 thread，删除后这个 thread 对自己和 AI 都不可见
  - 可以将 thread 标记完成，这个 thread 对自己默认不可见，只有一个完成标记，可以展开看到详情；对于 AI 可见，同时标记已完成的信息
  - 可以删除单条 comment，用户只能删除自己的 comment，不能删除 AI 的 comment

需要在 `.workspace/...` 创建子目录，首先整理需求，确保需求清晰，然后做好插件设计，尽可能详细、清晰、可落地。若发现需要讨论的需求、设计和实现细节，单独写一份文档。

新插件需要放在 `$PERSONAL` 目录，远端 Git 仓库放在 `github.com/huandu` 名下。设计讨论清楚前不写任何代码，需要用户确认后再开始。

## 开放问题反馈

### Q-07

为了让用户能够主动表达“已解决”的意思，当用户标记为 `changes_requested` 或者 `reject` 之后，用户可以在 AI 对代码发生修改后，在 diff side panel 中看到一个可点击的 Approve 按钮。按钮放在 start review 后出现的提交按钮位置，并且实际上就是一个提交按钮。点击后出现与 start review 后相同的提交对话框，动作默认选择 Approve。`approve` 与 `comment`、`request_change`、`reject` 并列。用户也可以输入文字，与普通提交没有区别。如果用户通过任何方式 start review，则独立 Approve 按钮不需要出现；点击普通提交按钮后，对话框仍包含 Approve 选项，但默认选中 `comment`。

### 其他问题

Q-07 之外全部采用推荐方案 A。

### 项目治理补充

- 创建项目时写好 `AGENTS.md`，做好各种围栏和约束，确保每次提交都经过 lint、编译检查、测试、格式检查等。
- 项目需要 `docs/` 目录，记录原始需求、当前最新设计和重大设计变更。
- `AGENTS.md` 要求涉及文档修改的场景，例如新功能或设计重构，必须在 commit 中同时包含代码与对应文档，方便追踪。
- 增加必要的开源项目文档，协议采用 MIT。
- 可以升级本地 DSH，源码目录位于 `$THIRD/deepseek-harness`。
- 检查是否还有待确认问题；没有则等待用户确认后再真正开工。

## Approve 与 Review 聚合的进一步澄清

- `Start review` 针对一个 diff，一个 diff 内可以包含多个 comment thread。
- 提交 review 时选择的 `request_changes` 或 `reject` 针对整个 review，不针对某一个 thread。
- 后续的 `approve` 同样针对整个 review。
- 手动 resolve thread 不会自动产生 approve。即使所有 thread 都已 resolve，仍需用户主动 approve。
- approve 之后也不存在终结态，用户和 AI 仍可以继续添加评论。
- comment thread 必须持久化。数据结构应以 review 作为组，类似 GitHub PR：一个 review 包含一组 thread，并与 diff 绑定。
- review 与 diff 的绑定应尽可能稳定。已提交变更应使用 git repo 与 revision diff 作为身份依据。
