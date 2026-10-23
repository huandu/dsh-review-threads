import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import { DIFF_PATH, SUMMARY_PATH, type ReviewSummary } from './protocol.js'

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

export function registerReviewRoutes(ctx: Context): void {
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
}
