import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import type { AnchorInput } from './anchor.js'
import {
  ACTION_PATH,
  DIFF_PATH,
  EVENTS_PATH,
  REVISION_DIFF_PATH,
  REVISION_SUMMARY_PATH,
  REVIEW_STATE_PATH,
  SUMMARY_PATH,
  type ReviewState,
  type ReviewSummary,
  type ReviewThreadView,
} from './protocol.js'
import { eventStream, type RealtimeHub } from './realtime.js'
import { hashJson } from './scope.js'
import './types.js'

const NUMERIC = /^\d+$/

function coordinate(value: string | null): number | undefined {
  if (value === null || !NUMERIC.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function badRequest(message: string): Response {
  return json({ error: 'invalid-request', message }, 400)
}

function conflict(message: string): Response {
  return json({ error: 'conflict', message }, 409)
}

function summaryHandler(ctx: Context, request: Request): Response {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  if (sessionId === null || sessionId.length === 0 || seq === undefined) {
    return badRequest('Invalid change summary coordinates.')
  }
  const summary = ctx.workspaceChanges.summary(sessionId as SessionId, seq)
  if (summary === undefined) return json({ error: 'not-found' }, 404)
  const body: ReviewSummary = {
    turn: summary.turn,
    files: summary.files,
    total: summary.total,
    added: summary.added,
    deleted: summary.deleted,
  }
  return json(body)
}

async function diffHandler(ctx: Context, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  const index = coordinate(query.get('index'))
  if (
    sessionId === null ||
    sessionId.length === 0 ||
    seq === undefined ||
    index === undefined
  ) {
    return badRequest('Invalid change diff coordinates.')
  }
  try {
    const diff = await ctx.workspaceChanges.diff(
      sessionId as SessionId,
      seq,
      index,
      request.signal,
    )
    return diff === undefined ? json({ error: 'not-found' }, 404) : json(diff)
  } catch {
    request.signal.throwIfAborted()
    return json({ error: 'diff-unavailable' }, 500)
  }
}

async function revisionSummaryHandler(
  ctx: Context,
  request: Request,
): Promise<Response> {
  const scopeKey = new URL(request.url).searchParams.get('scopeKey')
  if (
    scopeKey === null ||
    (!scopeKey.startsWith('rev:') && !scopeKey.startsWith('work:'))
  ) {
    return badRequest('Invalid diff scope.')
  }
  try {
    const scope = ctx.reviewThreads.get(scopeKey)
    return json(
      scope?.kind === 'work'
        ? await ctx.reviewThreads.workingSummary(scopeKey, request.signal)
        : await ctx.reviewThreads.revisionSummary(scopeKey, request.signal),
    )
  } catch {
    request.signal.throwIfAborted()
    return json({ error: 'revision-unavailable' }, 404)
  }
}

async function revisionDiffHandler(
  ctx: Context,
  request: Request,
): Promise<Response> {
  const query = new URL(request.url).searchParams
  const scopeKey = query.get('scopeKey')
  const index = coordinate(query.get('index'))
  if (
    scopeKey === null ||
    (!scopeKey.startsWith('rev:') && !scopeKey.startsWith('work:')) ||
    index === undefined
  ) {
    return badRequest('Invalid diff comparison coordinates.')
  }
  try {
    const scope = ctx.reviewThreads.get(scopeKey)
    const diff =
      scope?.kind === 'work'
        ? await ctx.reviewThreads.workingDiff(scopeKey, index, request.signal)
        : await ctx.reviewThreads.revisionDiff(scopeKey, index, request.signal)
    return diff === undefined ? json({ error: 'not-found' }, 404) : json(diff)
  } catch {
    request.signal.throwIfAborted()
    return json({ error: 'revision-unavailable' }, 404)
  }
}

async function reviewStateHandler(
  ctx: Context,
  request: Request,
): Promise<Response> {
  const query = new URL(request.url).searchParams
  const scopeKey = query.get('scopeKey')
  const sessionId = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  const turn = coordinate(query.get('turn'))
  if (sessionId === null || sessionId.length === 0) {
    return badRequest('Invalid review coordinates.')
  }
  let scope
  if (scopeKey !== null) {
    if (!scopeKey.startsWith('rev:') && !scopeKey.startsWith('work:')) {
      return badRequest('Invalid review scope.')
    }
    scope = ctx.reviewThreads.get(scopeKey)
    if (scope === undefined) return json({ error: 'not-found' }, 404)
    if (scope.kind === 'work') {
      if (scope.sessionId !== sessionId) {
        return badRequest('Working review belongs to another session.')
      }
      await ctx.reviewThreads.refreshWorking(scopeKey, request.signal)
    }
  } else {
    if (seq === undefined || turn === undefined) {
      return badRequest('Invalid turn review coordinates.')
    }
    const summary = ctx.workspaceChanges.summary(sessionId as SessionId, seq)
    if (summary === undefined) return json({ error: 'not-found' }, 404)
    const snapshot = summary.snapshot
    const diffs =
      snapshot === undefined
        ? await Promise.all(
            summary.files.map((_, index) =>
              ctx.workspaceChanges.diff(
                sessionId as SessionId,
                seq,
                index,
                request.signal,
              ),
            ),
          )
        : undefined
    const patchDigest = hashJson({
      summary: {
        turn: summary.turn,
        files: summary.files,
        total: summary.total,
        added: summary.added,
        deleted: summary.deleted,
        snapshot,
      },
      diffs,
    })
    scope = await ctx.reviewThreads.resolveTurn({
      sessionId: sessionId as SessionId,
      eventSeq: seq,
      turn,
      patchDigest,
    })
  }
  const review = ctx.reviewThreads.getReview(scope.reviewId)
  if (review === undefined) return json({ error: 'review-unavailable' }, 500)
  const currentTurn = turn ?? 0
  const draft = ctx.reviewThreads.draftFor(scope.reviewId, sessionId)
  const state: ReviewState = {
    reviewId: review.reviewId,
    scopeKey: scope.scopeKey,
    currentDecision: review.currentDecision,
    approvalAvailable: ctx.reviewThreads.approvalAvailable(
      review.reviewId,
      sessionId,
    ),
    currentTurn,
    scope: {
      kind: scope.kind,
      repoIdentity: scope.repoIdentity,
      baseOid: scope.baseOid,
      headOid: scope.headOid,
    },
    bindingSuggestion:
      scope.kind === 'rev'
        ? (ctx.reviewThreads.bindingSuggestion(
            scope.scopeKey,
            sessionId as SessionId,
          ) ?? null)
        : null,
    threads: ctx.reviewThreads
      .userThreads(review.reviewId)
      .map((thread): ReviewThreadView => ({
        threadId: thread.threadId,
        anchor: {
          path: thread.anchor.path,
          side: thread.anchor.side,
          line: thread.anchor.line,
          startLine: thread.anchor.startLine,
        },
        status: thread.status,
        revision: thread.revision,
        createdBy: thread.createdBy,
        comments: thread.comments.map((comment) => ({
          commentId: comment.commentId,
          author: comment.author,
          body: comment.body,
          edited: comment.edited,
          createdAt: comment.createdAt,
        })),
      })),
    draft:
      draft === undefined
        ? null
        : {
            draftId: draft.draftId,
            turn: draft.turn,
            verdict: draft.verdict,
            summaryText: draft.summaryText,
            threadIds: draft.threadIds,
          },
  }
  return json(state)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown, name: string, max = 20_000): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > max
  ) {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

function anchorInput(value: unknown): AnchorInput {
  const input = record(value)
  if (input === undefined) throw new Error('Invalid anchor')
  const side = input['side']
  if (side !== 'old' && side !== 'new') throw new Error('Invalid anchor side')
  return {
    path: text(input['path'], 'anchor path', 4096),
    side,
    line: Math.max(1, number(input['line'], 'anchor line')),
    startLine: Math.max(1, number(input['startLine'], 'anchor start line')),
    lineText: text(input['lineText'], 'anchor line text', 100_000),
    beforeText:
      typeof input['beforeText'] === 'string' ? input['beforeText'] : null,
    afterText:
      typeof input['afterText'] === 'string' ? input['afterText'] : null,
    hunkHeader: text(input['hunkHeader'], 'hunk header', 10_000),
    hunkText: text(input['hunkText'], 'hunk text', 1_000_000),
    snapshotRevision: text(input['snapshotRevision'], 'snapshot revision', 256),
  }
}

async function actionHandler(
  ctx: Context,
  request: Request,
): Promise<Response> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return badRequest('Invalid JSON body.')
  }
  const body = record(parsed)
  if (body === undefined) return badRequest('Action body must be an object.')
  try {
    const action = text(body['action'], 'action', 64)
    const sessionId = text(body['sessionId'], 'sessionId', 1024) as SessionId
    const reviewId = text(body['reviewId'], 'reviewId', 256)
    const turn = number(body['turn'], 'turn')
    const review = ctx.reviewThreads.getReview(reviewId)
    if (review === undefined) return json({ error: 'not-found' }, 404)
    const activeScope = ctx.reviewThreads.get(review.activeScopeKey)
    if (activeScope?.kind === 'work' && activeScope.sessionId !== sessionId) {
      return conflict('Working review belongs to another session')
    }
    if (action === 'bind_work_scope') {
      if (activeScope?.kind !== 'rev') {
        return conflict('Only a revision review can receive a working review')
      }
      const binding = await ctx.reviewThreads.bindWorkingToRevision({
        workScopeKey: text(body['workScopeKey'], 'workScopeKey', 20_000),
        revisionScopeKey: activeScope.scopeKey,
        sessionId,
      })
      return json({ ok: true, binding })
    }
    const approvalAvailable = ctx.reviewThreads.approvalAvailable(
      reviewId,
      sessionId,
    )
    const draft = await ctx.reviewThreads.ensureDraft(reviewId, sessionId, turn)
    switch (action) {
      case 'add_comment': {
        await ctx.reviewThreads.addUserComment({
          reviewId,
          sessionId,
          turn: draft.turn,
          anchor: anchorInput(body['anchor']),
          body: text(body['body'], 'comment'),
        })
        break
      }
      case 'edit_comment': {
        await ctx.reviewThreads.editUserComment({
          reviewId,
          sessionId,
          turn: draft.turn,
          threadId: text(body['threadId'], 'threadId', 256),
          commentId: text(body['commentId'], 'commentId', 256),
          body: text(body['body'], 'comment'),
        })
        break
      }
      case 'delete_comment': {
        await ctx.reviewThreads.deleteUserComment({
          reviewId,
          sessionId,
          turn: draft.turn,
          threadId: text(body['threadId'], 'threadId', 256),
          commentId: text(body['commentId'], 'commentId', 256),
        })
        break
      }
      case 'resolve_thread':
      case 'reopen_thread': {
        await ctx.reviewThreads.setThreadStatus({
          reviewId,
          sessionId,
          turn: draft.turn,
          threadId: text(body['threadId'], 'threadId', 256),
          status: action === 'resolve_thread' ? 'resolved' : 'open',
        })
        break
      }
      case 'delete_thread': {
        await ctx.reviewThreads.deleteThread({
          reviewId,
          sessionId,
          turn: draft.turn,
          threadId: text(body['threadId'], 'threadId', 256),
        })
        break
      }
      case 'update_draft': {
        const verdict = body['verdict']
        if (
          verdict !== 'approve' &&
          verdict !== 'comment' &&
          verdict !== 'request_changes' &&
          verdict !== 'reject'
        ) {
          throw new Error('Invalid verdict')
        }
        await ctx.reviewThreads.updateDraft(draft.draftId, {
          verdict,
          summaryText:
            typeof body['summaryText'] === 'string'
              ? body['summaryText'].slice(0, 20_000)
              : draft.summaryText,
        })
        break
      }
      case 'cancel_draft': {
        await ctx.reviewThreads.cancelDraft(draft.draftId)
        break
      }
      case 'submit_review': {
        const verdict = body['verdict']
        if (
          verdict !== 'approve' &&
          verdict !== 'comment' &&
          verdict !== 'request_changes' &&
          verdict !== 'reject'
        ) {
          throw new Error('Invalid verdict')
        }
        if (
          draft.threadIds.length === 0 &&
          (verdict !== 'approve' || !approvalAvailable)
        ) {
          return conflict('No review is ready to submit')
        }
        await ctx.reviewThreads.updateDraft(draft.draftId, {
          verdict,
          summaryText:
            typeof body['summaryText'] === 'string'
              ? body['summaryText'].slice(0, 20_000)
              : draft.summaryText,
        })
        const submission = await ctx.reviewThreads.submitDraft(draft.draftId)
        return json({ ok: true, submission })
      }
      default:
        return badRequest(`Unknown action: ${action}`)
    }
    return json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid')) {
      return badRequest(error.message)
    }
    if (error instanceof Error) return conflict(error.message)
    return json({ error: 'action-failed' }, 500)
  }
}

export function registerReviewRoutes(
  ctx: Context,
  realtime: RealtimeHub,
): void {
  ctx.connection.fetch.register({
    path: SUMMARY_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => Promise.resolve(summaryHandler(ctx, request)),
  })
  ctx.connection.fetch.register({
    path: DIFF_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => diffHandler(ctx, request),
  })
  ctx.connection.fetch.register({
    path: REVISION_SUMMARY_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => revisionSummaryHandler(ctx, request),
  })
  ctx.connection.fetch.register({
    path: REVISION_DIFF_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => revisionDiffHandler(ctx, request),
  })
  ctx.connection.fetch.register({
    path: REVIEW_STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => reviewStateHandler(ctx, request),
  })
  ctx.connection.fetch.register({
    path: ACTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => actionHandler(ctx, request),
  })
  ctx.connection.fetch.register({
    path: EVENTS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) =>
      Promise.resolve(
        new Response(eventStream(realtime, request.signal), {
          headers: {
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'content-type': 'text/event-stream; charset=utf-8',
          },
        }),
      ),
  })
}
