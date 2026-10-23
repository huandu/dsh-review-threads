import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { createAnchor, type AnchorInput } from './anchor.js'
import {
  reviewThreadsDomain,
  type CommentRecord,
  type Decision,
  type DiffAnchor,
  type ReviewDraft,
  type ReviewOperation,
  type ReviewRecord,
  type ReviewSubmission,
  type ScopeRecord,
  type ThreadRecord,
  type ThreadStatus,
} from './domain.js'
import { resolveRepositoryIdentity, type GitRunner } from './git.js'
import { renderReviewSubmission } from './prompt.js'
import {
  DEFAULT_REVISION_DIFF_SPEC,
  normalizeDiffSpec,
  revisionScopeKey,
  turnScopeKey,
  workScopeKey,
  type RevisionDiffSpec,
} from './scope.js'

type ReviewThreadsDomain = Domain<typeof reviewThreadsDomain>

export interface TurnScopeInput {
  readonly sessionId: SessionId
  readonly eventSeq: number
  readonly turn: number
  readonly patchDigest: string
}

export interface WorkingScopeInput {
  readonly sessionId: SessionId
  readonly cwd: string
}

export interface RevisionScopeInput {
  readonly repoIdentity: string
  readonly baseOid: string
  readonly headOid: string
  readonly diffSpec?: RevisionDiffSpec
}

export class ReviewThreadService {
  private readonly pendingScopes = new Map<string, Promise<ScopeRecord>>()

  constructor(
    private readonly ctx: Context,
    private readonly domain: ReviewThreadsDomain,
    private readonly git: GitRunner,
  ) {}

  private scopes() {
    return this.domain.table('scopes')
  }

  private async putScope(record: ScopeRecord): Promise<ScopeRecord> {
    await this.scopes().put(record.scopeKey, record)
    return record
  }

  get(scopeKey: string): ScopeRecord | undefined {
    return this.scopes().get(scopeKey)
  }

  private reviews() {
    return this.domain.table('reviews')
  }

  private threads() {
    return this.domain.table('threads')
  }

  private drafts() {
    return this.domain.table('review_drafts')
  }

  private submissions() {
    return this.domain.table('review_submissions')
  }

  private async createScope(
    record: Omit<ScopeRecord, 'reviewId'>,
  ): Promise<ScopeRecord> {
    const existing = this.scopes().get(record.scopeKey)
    if (existing !== undefined) return existing
    const pending = this.pendingScopes.get(record.scopeKey)
    if (pending !== undefined) return pending
    const task = (async () => {
      const reviewId = randomUUID()
      const now = new Date().toISOString()
      const review: ReviewRecord = {
        reviewId,
        activeScopeKey: record.scopeKey,
        currentDecision: null,
        currentDecisionAt: null,
        currentDecisionSubmissionId: null,
        codeChangedSinceDecision: false,
        createdAt: now,
        updatedAt: now,
      }
      const scope: ScopeRecord = { ...record, reviewId }
      await this.reviews().put(reviewId, review)
      await this.scopes().put(scope.scopeKey, scope)
      return scope
    })().finally(() => {
      this.pendingScopes.delete(record.scopeKey)
    })
    this.pendingScopes.set(record.scopeKey, task)
    return task
  }

  async resolveTurn(input: TurnScopeInput): Promise<ScopeRecord> {
    const key = turnScopeKey(input.sessionId, input.eventSeq, input.patchDigest)
    const now = new Date().toISOString()
    return this.createScope({
      scopeKey: key,
      kind: 'turn',
      repoIdentity: null,
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      turn: input.turn,
      baseOid: null,
      headOid: null,
      patchDigest: input.patchDigest,
      diffSpecDigest: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  async resolveWorking(input: WorkingScopeInput): Promise<ScopeRecord> {
    const repo = await resolveRepositoryIdentity(this.git, input.cwd)
    if (repo === undefined)
      throw new Error('The working directory is not a Git repository')
    const baseOid = repo.headOid ?? 'EMPTY_TREE'
    const key = workScopeKey(repo.identity, input.sessionId, baseOid)
    const now = new Date().toISOString()
    return this.createScope({
      scopeKey: key,
      kind: 'work',
      repoIdentity: repo.identity,
      sessionId: input.sessionId,
      eventSeq: null,
      turn: null,
      baseOid,
      headOid: null,
      patchDigest: null,
      diffSpecDigest: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  async resolveRevision(input: RevisionScopeInput): Promise<ScopeRecord> {
    const diffSpec = input.diffSpec ?? DEFAULT_REVISION_DIFF_SPEC
    const key = revisionScopeKey(
      input.repoIdentity,
      input.baseOid,
      input.headOid,
      diffSpec,
    )
    const now = new Date().toISOString()
    return this.createScope({
      scopeKey: key,
      kind: 'rev',
      repoIdentity: input.repoIdentity,
      sessionId: null,
      eventSeq: null,
      turn: null,
      baseOid: input.baseOid,
      headOid: input.headOid,
      patchDigest: null,
      diffSpecDigest: normalizeDiffSpec(diffSpec),
      createdAt: now,
      updatedAt: now,
    })
  }

  getReview(reviewId: string): ReviewRecord | undefined {
    return this.reviews().get(reviewId)
  }

  latestReviewForSession(sessionId: string): ReviewRecord | undefined {
    const scope = [...this.scopes().entries()]
      .map(([, value]) => value)
      .filter((value) => value.sessionId === sessionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    return scope === undefined ? undefined : this.reviews().get(scope.reviewId)
  }

  getThread(threadId: string): ThreadRecord | undefined {
    return this.threads().get(threadId)
  }

  getDraft(draftId: string): ReviewDraft | undefined {
    return this.drafts().get(draftId)
  }

  draftFor(reviewId: string, sessionId: string): ReviewDraft | undefined {
    return [...this.drafts().entries()]
      .map(([, draft]) => draft)
      .filter(
        (draft) => draft.reviewId === reviewId && draft.sessionId === sessionId,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  }

  getSubmission(submissionId: string): ReviewSubmission | undefined {
    return this.submissions().get(submissionId)
  }

  async markCodeChanged(sessionId: string): Promise<void> {
    const scopes = [...this.scopes().entries()]
      .map(([, scope]) => scope)
      .filter((scope) => scope.sessionId === sessionId)
    for (const scope of scopes) {
      const review = this.reviews().get(scope.reviewId)
      if (
        review === undefined ||
        (review.currentDecision !== 'request_changes' &&
          review.currentDecision !== 'reject') ||
        review.codeChangedSinceDecision
      ) {
        continue
      }
      await this.reviews().put(review.reviewId, {
        ...review,
        codeChangedSinceDecision: true,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  approvalAvailable(reviewId: string, sessionId: string): boolean {
    const review = this.reviews().get(reviewId)
    return (
      review !== undefined &&
      (review.currentDecision === 'request_changes' ||
        review.currentDecision === 'reject') &&
      review.codeChangedSinceDecision &&
      this.draftFor(reviewId, sessionId) === undefined
    )
  }

  threadsForReview(reviewId: string): readonly ThreadRecord[] {
    return [...this.threads().entries()]
      .map(([, thread]) => thread)
      .filter((thread) => thread.reviewId === reviewId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  userThreads(reviewId: string): readonly ThreadRecord[] {
    return this.threadsForReview(reviewId)
      .filter((thread) => thread.deletedAt === null)
      .map((thread) => ({
        ...thread,
        comments: thread.comments.filter(
          (comment) => comment.deletedAt === null,
        ),
      }))
  }

  private threadForAnchor(
    reviewId: string,
    path: string,
    side: DiffAnchor['side'],
    line: number,
  ): ThreadRecord | undefined {
    return this.threadsForReview(reviewId).find(
      (thread) =>
        thread.deletedAt === null &&
        thread.anchor.path === path &&
        thread.anchor.side === side &&
        thread.anchor.line === line,
    )
  }

  private draftKey(reviewId: string, sessionId: string, turn: number): string {
    return `draft:${reviewId}:${sessionId}:${String(turn)}`
  }

  async ensureDraft(
    reviewId: string,
    sessionId: SessionId,
    turn: number,
  ): Promise<ReviewDraft> {
    if (this.reviews().get(reviewId) === undefined)
      throw new Error('Review does not exist')
    const key = this.draftKey(reviewId, sessionId, turn)
    const existing = this.drafts().get(key)
    if (existing !== undefined) return existing
    const now = new Date().toISOString()
    const draft: ReviewDraft = {
      draftId: key,
      reviewId,
      sessionId,
      turn,
      verdict: 'comment',
      summaryText: '',
      threadIds: [],
      createdAt: now,
      updatedAt: now,
    }
    await this.drafts().put(key, draft)
    return draft
  }

  async updateDraft(
    draftId: string,
    update: {
      readonly verdict?: Decision
      readonly summaryText?: string
    },
  ): Promise<ReviewDraft> {
    const current = this.drafts().get(draftId)
    if (current === undefined) throw new Error('Review draft does not exist')
    const next: ReviewDraft = {
      ...current,
      verdict: update.verdict ?? current.verdict,
      summaryText: update.summaryText ?? current.summaryText,
      updatedAt: new Date().toISOString(),
    }
    await this.drafts().put(draftId, next)
    return next
  }

  async cancelDraft(draftId: string): Promise<boolean> {
    const draft = this.drafts().get(draftId)
    if (draft === undefined) return false
    for (const threadId of draft.threadIds) {
      const thread = this.threads().get(threadId)
      if (thread === undefined) continue
      const comments = thread.comments
        .filter(
          (comment) =>
            !(
              comment.draftId === draft.draftId &&
              comment.publishedRevision === null
            ),
        )
        .map((comment) =>
          comment.draftId === draft.draftId && comment.publishedBody !== null
            ? {
                ...comment,
                body: comment.publishedBody,
                deletedAt: comment.publishedDeletedAt,
                updatedAt: new Date().toISOString(),
              }
            : comment,
        )
      if (thread.publishedRevision === null || comments.length === 0) {
        await this.threads().delete(thread.threadId)
        continue
      }
      await this.threads().put(thread.threadId, {
        ...thread,
        status: thread.publishedStatus,
        deletedAt: thread.publishedDeletedAt,
        pendingDraftIds: thread.pendingDraftIds.filter(
          (id) => id !== draft.draftId,
        ),
        comments,
        updatedAt: new Date().toISOString(),
      })
    }
    return this.drafts().delete(draftId)
  }

  private addDraftThread(draft: ReviewDraft, threadId: string): ReviewDraft {
    if (draft.threadIds.includes(threadId)) return draft
    return { ...draft, threadIds: [...draft.threadIds, threadId] }
  }

  private async saveDraftThread(
    draft: ReviewDraft,
    threadId: string,
  ): Promise<void> {
    const next = {
      ...this.addDraftThread(draft, threadId),
      updatedAt: new Date().toISOString(),
    }
    await this.drafts().put(next.draftId, next)
  }

  async addUserComment(input: {
    readonly reviewId: string
    readonly sessionId: SessionId
    readonly turn: number
    readonly anchor: AnchorInput
    readonly body: string
  }): Promise<{ readonly draft: ReviewDraft; readonly thread: ThreadRecord }> {
    const draft = await this.ensureDraft(
      input.reviewId,
      input.sessionId,
      input.turn,
    )
    const anchor = createAnchor(input.anchor)
    let thread = this.threadForAnchor(
      input.reviewId,
      anchor.path,
      anchor.side,
      anchor.line,
    )
    const now = new Date().toISOString()
    const comment: CommentRecord = {
      commentId: randomUUID(),
      author: 'user',
      body: input.body,
      publishedBody: null,
      publishedRevision: null,
      draftId: draft.draftId,
      deletedAt: null,
      publishedDeletedAt: null,
      edited: false,
      createdAt: now,
      updatedAt: now,
    }
    if (thread === undefined) {
      thread = {
        threadId: randomUUID(),
        reviewId: input.reviewId,
        anchor,
        status: 'open',
        publishedStatus: 'open',
        revision: 1,
        publishedRevision: null,
        pendingDraftIds: [draft.draftId],
        comments: [comment],
        deletedAt: null,
        publishedDeletedAt: null,
        createdBy: 'user',
        createdAt: now,
        updatedAt: now,
      }
    } else {
      thread = {
        ...thread,
        revision: thread.revision + 1,
        pendingDraftIds: thread.pendingDraftIds.includes(draft.draftId)
          ? thread.pendingDraftIds
          : [...thread.pendingDraftIds, draft.draftId],
        comments: [...thread.comments, comment],
        updatedAt: now,
      }
    }
    await this.threads().put(thread.threadId, thread)
    await this.saveDraftThread(draft, thread.threadId)
    return { draft: this.drafts().get(draft.draftId) ?? draft, thread }
  }

  async addAgentComment(input: {
    readonly reviewId: string
    readonly anchor: AnchorInput
    readonly body: string
  }): Promise<ThreadRecord> {
    if (this.reviews().get(input.reviewId) === undefined)
      throw new Error('Review does not exist')
    const anchor = createAnchor(input.anchor)
    let thread = this.threadForAnchor(
      input.reviewId,
      anchor.path,
      anchor.side,
      anchor.line,
    )
    const now = new Date().toISOString()
    const nextRevision = (thread?.revision ?? 0) + 1
    const comment: CommentRecord = {
      commentId: randomUUID(),
      author: 'agent',
      body: input.body,
      publishedBody: input.body,
      publishedRevision: nextRevision,
      draftId: null,
      deletedAt: null,
      publishedDeletedAt: null,
      edited: false,
      createdAt: now,
      updatedAt: now,
    }
    if (thread === undefined) {
      thread = {
        threadId: randomUUID(),
        reviewId: input.reviewId,
        anchor,
        status: 'open',
        publishedStatus: 'open',
        revision: 1,
        publishedRevision: 1,
        pendingDraftIds: [],
        comments: [comment],
        deletedAt: null,
        publishedDeletedAt: null,
        createdBy: 'agent',
        createdAt: now,
        updatedAt: now,
      }
    } else {
      if (thread.status === 'resolved') throw new Error('Thread is resolved')
      thread = {
        ...thread,
        revision: nextRevision,
        publishedRevision: nextRevision,
        comments: [...thread.comments, comment],
        updatedAt: now,
      }
    }
    await this.threads().put(thread.threadId, thread)
    return thread
  }

  async editUserComment(input: {
    readonly reviewId: string
    readonly sessionId: SessionId
    readonly turn: number
    readonly threadId: string
    readonly commentId: string
    readonly body: string
  }): Promise<ThreadRecord> {
    const draft = await this.ensureDraft(
      input.reviewId,
      input.sessionId,
      input.turn,
    )
    const thread = this.threads().get(input.threadId)
    if (thread === undefined || thread.reviewId !== input.reviewId)
      throw new Error('Thread does not exist')
    const comment = thread.comments.find(
      (item) => item.commentId === input.commentId,
    )
    if (comment === undefined || comment.author !== 'user')
      throw new Error('Only the user can edit their own comment')
    const now = new Date().toISOString()
    const next: ThreadRecord = {
      ...thread,
      revision: thread.revision + 1,
      pendingDraftIds: thread.pendingDraftIds.includes(draft.draftId)
        ? thread.pendingDraftIds
        : [...thread.pendingDraftIds, draft.draftId],
      comments: thread.comments.map((item) =>
        item.commentId === input.commentId
          ? { ...item, body: input.body, edited: true, updatedAt: now }
          : item,
      ),
      updatedAt: now,
    }
    await this.threads().put(next.threadId, next)
    await this.saveDraftThread(draft, next.threadId)
    return next
  }

  async deleteUserComment(input: {
    readonly reviewId: string
    readonly sessionId: SessionId
    readonly turn: number
    readonly threadId: string
    readonly commentId: string
  }): Promise<ThreadRecord> {
    const draft = await this.ensureDraft(
      input.reviewId,
      input.sessionId,
      input.turn,
    )
    const thread = this.threads().get(input.threadId)
    if (thread === undefined || thread.reviewId !== input.reviewId)
      throw new Error('Thread does not exist')
    const comment = thread.comments.find(
      (item) => item.commentId === input.commentId,
    )
    if (comment === undefined || comment.author !== 'user')
      throw new Error('Only the user can delete their own comment')
    const now = new Date().toISOString()
    const next: ThreadRecord = {
      ...thread,
      revision: thread.revision + 1,
      pendingDraftIds: thread.pendingDraftIds.includes(draft.draftId)
        ? thread.pendingDraftIds
        : [...thread.pendingDraftIds, draft.draftId],
      comments: thread.comments.map((item) =>
        item.commentId === input.commentId
          ? { ...item, deletedAt: now, updatedAt: now }
          : item,
      ),
      updatedAt: now,
    }
    await this.threads().put(next.threadId, next)
    await this.saveDraftThread(draft, next.threadId)
    return next
  }

  async setThreadStatus(input: {
    readonly reviewId: string
    readonly sessionId: SessionId
    readonly turn: number
    readonly threadId: string
    readonly status: ThreadStatus
  }): Promise<ThreadRecord> {
    const draft = await this.ensureDraft(
      input.reviewId,
      input.sessionId,
      input.turn,
    )
    const thread = this.threads().get(input.threadId)
    if (thread === undefined || thread.reviewId !== input.reviewId)
      throw new Error('Thread does not exist')
    const next: ThreadRecord = {
      ...thread,
      status: input.status,
      revision: thread.revision + 1,
      pendingDraftIds: thread.pendingDraftIds.includes(draft.draftId)
        ? thread.pendingDraftIds
        : [...thread.pendingDraftIds, draft.draftId],
      updatedAt: new Date().toISOString(),
    }
    await this.threads().put(next.threadId, next)
    await this.saveDraftThread(draft, next.threadId)
    return next
  }

  async deleteThread(input: {
    readonly reviewId: string
    readonly sessionId: SessionId
    readonly turn: number
    readonly threadId: string
  }): Promise<ThreadRecord> {
    const draft = await this.ensureDraft(
      input.reviewId,
      input.sessionId,
      input.turn,
    )
    const thread = this.threads().get(input.threadId)
    if (thread === undefined || thread.reviewId !== input.reviewId)
      throw new Error('Thread does not exist')
    const next: ThreadRecord = {
      ...thread,
      deletedAt: new Date().toISOString(),
      revision: thread.revision + 1,
      pendingDraftIds: thread.pendingDraftIds.includes(draft.draftId)
        ? thread.pendingDraftIds
        : [...thread.pendingDraftIds, draft.draftId],
      updatedAt: new Date().toISOString(),
    }
    await this.threads().put(next.threadId, next)
    await this.saveDraftThread(draft, next.threadId)
    return next
  }

  aiThreads(reviewId: string): readonly ThreadRecord[] {
    return this.threadsForReview(reviewId)
      .filter((thread) => thread.publishedRevision !== null)
      .filter((thread) => thread.publishedDeletedAt === null)
      .map((thread) => ({
        ...thread,
        status: thread.publishedStatus,
        comments: thread.comments
          .filter((comment) => comment.publishedRevision !== null)
          .map((comment) => ({
            ...comment,
            body:
              comment.publishedDeletedAt === null
                ? (comment.publishedBody ?? '')
                : '',
          })),
      }))
  }

  private operationsForDraft(draft: ReviewDraft): {
    readonly operations: readonly ReviewOperation[]
    readonly threads: ReadonlyMap<string, ThreadRecord>
  } {
    const operations: ReviewOperation[] = []
    const threads = new Map<string, ThreadRecord>()
    const now = new Date().toISOString()
    for (const threadId of draft.threadIds) {
      const thread = this.threads().get(threadId)
      if (thread === undefined) continue
      if (thread.publishedRevision === null) {
        if (thread.deletedAt === null) {
          operations.push({
            kind: 'thread_created',
            threadId: thread.threadId,
            commentId: null,
            body: null,
            anchor: thread.anchor,
            threadStatus: thread.status,
          })
          for (const comment of thread.comments) {
            if (
              comment.author === 'user' &&
              comment.publishedRevision === null &&
              comment.deletedAt === null
            ) {
              operations.push({
                kind: 'comment_added',
                threadId: thread.threadId,
                commentId: comment.commentId,
                body: comment.body,
                anchor: thread.anchor,
                threadStatus: null,
              })
            }
          }
        }
      } else if (
        thread.deletedAt !== null &&
        thread.publishedDeletedAt === null
      ) {
        operations.push({
          kind: 'thread_deleted',
          threadId: thread.threadId,
          commentId: null,
          body: null,
          anchor: null,
          threadStatus: null,
        })
      } else if (thread.deletedAt === null) {
        if (thread.status !== thread.publishedStatus) {
          operations.push({
            kind:
              thread.status === 'resolved'
                ? 'thread_resolved'
                : 'thread_reopened',
            threadId: thread.threadId,
            commentId: null,
            body: null,
            anchor: thread.anchor,
            threadStatus: thread.status,
          })
        }
        for (const comment of thread.comments) {
          if (comment.publishedRevision === null) {
            if (comment.deletedAt === null && comment.author === 'user') {
              operations.push({
                kind: 'comment_added',
                threadId: thread.threadId,
                commentId: comment.commentId,
                body: comment.body,
                anchor: thread.anchor,
                threadStatus: null,
              })
            }
          } else if (
            comment.deletedAt !== null &&
            comment.publishedDeletedAt === null
          ) {
            operations.push({
              kind: 'comment_deleted',
              threadId: thread.threadId,
              commentId: comment.commentId,
              body: null,
              anchor: thread.anchor,
              threadStatus: null,
            })
          } else if (
            comment.deletedAt === null &&
            comment.body !== comment.publishedBody
          ) {
            operations.push({
              kind: 'comment_edited',
              threadId: thread.threadId,
              commentId: comment.commentId,
              body: comment.body,
              anchor: thread.anchor,
              threadStatus: null,
            })
          }
        }
      }
      const next: ThreadRecord = {
        ...thread,
        publishedStatus: thread.status,
        publishedRevision: thread.revision,
        publishedDeletedAt: thread.deletedAt,
        pendingDraftIds: thread.pendingDraftIds.filter(
          (item) => item !== draft.draftId,
        ),
        comments: thread.comments.map((comment) => ({
          ...comment,
          publishedRevision: comment.publishedRevision ?? thread.revision,
          publishedBody:
            comment.publishedRevision === null
              ? comment.body
              : comment.publishedBody,
          publishedDeletedAt: comment.publishedDeletedAt ?? comment.deletedAt,
        })),
        updatedAt: now,
      }
      threads.set(next.threadId, next)
    }
    return { operations, threads }
  }

  async submitDraft(draftId: string): Promise<ReviewSubmission> {
    const draft = this.drafts().get(draftId)
    if (draft === undefined) throw new Error('Review draft does not exist')
    const review = this.reviews().get(draft.reviewId)
    if (review === undefined) throw new Error('Review does not exist')
    const { operations, threads } = this.operationsForDraft(draft)
    for (const thread of threads.values()) {
      await this.threads().put(thread.threadId, thread)
    }
    const now = new Date().toISOString()
    const submission: ReviewSubmission = {
      submissionId: randomUUID(),
      reviewId: draft.reviewId,
      sessionId: draft.sessionId,
      turn: draft.turn,
      verdict: draft.verdict,
      summaryText: draft.summaryText,
      operations: [...operations],
      state: 'submitting',
      messageId: null,
      createdAt: now,
      submittedAt: null,
    }
    await this.submissions().put(submission.submissionId, submission)
    await this.reviews().put(review.reviewId, {
      ...review,
      currentDecision: draft.verdict,
      currentDecisionAt: now,
      currentDecisionSubmissionId: submission.submissionId,
      codeChangedSinceDecision: false,
      updatedAt: now,
    })
    await this.drafts().delete(draftId)
    const agent = this.ctx.agents.get(draft.sessionId as SessionId)
    if (agent === undefined) {
      await this.submissions().put(submission.submissionId, {
        ...submission,
        state: 'submit_failed',
      })
      throw new Error('The target agent is no longer available')
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: renderReviewSubmission(submission) }],
      source: {
        kind: 'dsh-review-threads',
        form: 'notice',
        summary: `Submitted ${draft.verdict} review`,
      },
    })
    try {
      agent.followup(message)
    } catch (error) {
      await this.submissions().put(submission.submissionId, {
        ...submission,
        state: 'submit_failed',
      })
      throw error
    }
    const completed: ReviewSubmission = {
      ...submission,
      state: 'submitted',
      messageId: message.id,
      submittedAt: new Date().toISOString(),
    }
    await this.submissions().put(completed.submissionId, completed)
    return completed
  }
}
