import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type { AnchorInput } from './anchor.js'
import type { ReviewThreadService } from './service.js'
import './types.js'

const NO_AGENT = 'This tool requires an active DSH agent session.'

function sessionIdOf(
  exec: Parameters<ReturnType<typeof defineTool>['execute']>[1],
): string {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) throw new Error(NO_AGENT)
  return sessionId
}

function reviewFor(
  service: ReviewThreadService,
  sessionId: string,
  requested: string | undefined,
) {
  const review =
    requested === undefined
      ? service.latestReviewForSession(sessionId)
      : service.getReview(requested)
  if (review === undefined) throw new Error('Review not found')
  return review
}

function anchorFromArgs(args: {
  readonly path?: string
  readonly side?: string
  readonly line?: number
  readonly startLine?: number
  readonly lineText?: string
  readonly beforeText?: string
  readonly afterText?: string
  readonly hunkHeader?: string
  readonly hunkText?: string
  readonly snapshotRevision?: string
}): AnchorInput {
  if (
    args.path === undefined ||
    (args.side !== 'old' && args.side !== 'new') ||
    args.line === undefined ||
    args.lineText === undefined ||
    args.hunkHeader === undefined ||
    args.hunkText === undefined ||
    args.snapshotRevision === undefined
  ) {
    throw new Error('New review threads require a complete diff anchor')
  }
  return {
    path: args.path,
    side: args.side,
    line: args.line,
    lineText: args.lineText,
    ...(args.startLine === undefined ? {} : { startLine: args.startLine }),
    ...(args.beforeText === undefined ? {} : { beforeText: args.beforeText }),
    ...(args.afterText === undefined ? {} : { afterText: args.afterText }),
    hunkHeader: args.hunkHeader,
    hunkText: args.hunkText,
    snapshotRevision: args.snapshotRevision,
  }
}

export function registerReviewTools(
  ctx: Context,
  service: ReviewThreadService,
): void {
  ctx.tools.register(
    defineTool({
      name: 'review_threads_list',
      description:
        'List AI-visible review threads and the current whole-review decision. User draft comments are never included.',
      parameters: {
        reviewId: {
          type: 'string',
          description:
            'Review id; omitted uses the latest review in the session.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute(args, exec) {
        const review = reviewFor(service, sessionIdOf(exec), args.reviewId)
        return Promise.resolve(
          JSON.stringify({
            reviewId: review.reviewId,
            scopeKey: review.activeScopeKey,
            currentDecision: review.currentDecision,
            threads: service.aiThreads(review.reviewId),
          }),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'review_threads_get',
      description: 'Read one complete AI-visible review thread.',
      parameters: {
        threadId: {
          type: 'string',
          required: true,
          description: 'Thread id.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute(args, exec) {
        const sessionId = sessionIdOf(exec)
        const review = service.latestReviewForSession(sessionId)
        if (review === undefined) throw new Error('Review not found')
        const thread = service
          .aiThreads(review.reviewId)
          .find((item) => item.threadId === args.threadId)
        if (thread === undefined) throw new Error('Visible thread not found')
        return Promise.resolve(JSON.stringify(thread))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'review_threads_add_comment',
      description:
        'Add an AI-authored comment to a diff line or append it to an existing open review thread. The final reply must tell the user about the new comment.',
      parameters: {
        reviewId: {
          type: 'string',
          description:
            'Review id; omitted uses the latest review in the session.',
        },
        threadId: {
          type: 'string',
          description:
            'Existing thread id. When present, anchor fields are optional.',
        },
        path: { type: 'string', description: 'Repository-relative file path.' },
        side: { type: 'string', description: 'old or new diff side.' },
        line: {
          type: 'number',
          description: 'Line number on the selected side.',
        },
        startLine: {
          type: 'number',
          description: 'First line of a range; defaults to line.',
        },
        lineText: {
          type: 'string',
          description: 'Exact current text of the selected line.',
        },
        beforeText: {
          type: 'string',
          description: 'Text immediately before the selected line.',
        },
        afterText: {
          type: 'string',
          description: 'Text immediately after the selected line.',
        },
        hunkHeader: {
          type: 'string',
          description: 'The containing unified-diff hunk header.',
        },
        hunkText: {
          type: 'string',
          description: 'The containing unified-diff hunk body.',
        },
        snapshotRevision: {
          type: 'string',
          description: 'Diff snapshot identity.',
        },
        body: {
          type: 'string',
          required: true,
          description: 'AI comment text.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const review = reviewFor(service, sessionIdOf(exec), args.reviewId)
        const existing =
          args.threadId === undefined
            ? undefined
            : service.getThread(args.threadId)
        if (
          args.threadId !== undefined &&
          (existing === undefined || existing.reviewId !== review.reviewId)
        ) {
          throw new Error('Thread not found in this review')
        }
        const thread = await service.addAgentComment({
          reviewId: review.reviewId,
          anchor:
            existing === undefined
              ? anchorFromArgs(args)
              : {
                  path: existing.anchor.path,
                  side: existing.anchor.side,
                  line: existing.anchor.line,
                  startLine: existing.anchor.startLine,
                  lineText: '',
                  hunkHeader: existing.anchor.hunkHeader,
                  hunkText: '',
                  snapshotRevision: existing.anchor.snapshotRevision,
                },
          body: args.body,
        })
        const comment = thread.comments.at(-1)
        return JSON.stringify({
          announcementRequired: true,
          threadId: thread.threadId,
          commentId: comment?.commentId ?? null,
          path: thread.anchor.path,
          side: thread.anchor.side,
          line: thread.anchor.line,
        })
      },
    }),
  )
}
