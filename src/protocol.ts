import type {
  WorkspaceDiffHunk,
  WorkspaceFileDiff,
} from '@deepseek-ai/dsh-workspace-changes/types'

export const REVIEW_KIND = 'changes-review'
export const REVIEW_ID = 'dsh-review-threads'
export const REVIEW_ADDRESS_PREFIX = 'dsh-resource://changes-review/session/'
export const SUMMARY_PATH = '/api/plugins/dsh-review-threads/changes.summary'
export const DIFF_PATH = '/api/plugins/dsh-review-threads/changes.diff'
export const REVIEW_STATE_PATH = '/api/plugins/dsh-review-threads/review'
export const ACTION_PATH = '/api/plugins/dsh-review-threads/action'
export const EVENTS_PATH = '/api/plugins/dsh-review-threads/events'

export interface ReviewAddress {
  readonly sessionId: string
  readonly seq: number
  readonly turn: number
}

export interface ReviewSummary {
  readonly turn: number
  readonly files: readonly ReviewFileSummary[]
  readonly total: number
  readonly added: number
  readonly deleted: number
}

export interface ReviewFileSummary {
  readonly path: string
  readonly display: string
  readonly added: number
  readonly deleted: number
  readonly binary?: true
  readonly oversized?: true
}

export type ReviewFileDiff = WorkspaceFileDiff
export type ReviewDiffHunk = WorkspaceDiffHunk

export type ReviewDecision =
  'approve' | 'comment' | 'request_changes' | 'reject'
export type ReviewAuthor = 'user' | 'agent'
export type ReviewThreadStatus = 'open' | 'resolved' | 'outdated'

export interface ReviewCommentView {
  readonly commentId: string
  readonly author: ReviewAuthor
  readonly body: string
  readonly edited: boolean
  readonly createdAt: string
}

export interface ReviewAnchorView {
  readonly path: string
  readonly side: 'old' | 'new'
  readonly line: number
  readonly startLine: number
}

export interface ReviewThreadView {
  readonly threadId: string
  readonly anchor: ReviewAnchorView
  readonly status: ReviewThreadStatus
  readonly revision: number
  readonly createdBy: ReviewAuthor
  readonly comments: readonly ReviewCommentView[]
}

export interface ReviewDraftView {
  readonly draftId: string
  readonly turn: number
  readonly verdict: ReviewDecision
  readonly summaryText: string
  readonly threadIds: readonly string[]
}

export interface ReviewState {
  readonly reviewId: string
  readonly scopeKey: string
  readonly currentDecision: ReviewDecision | null
  readonly approvalAvailable: boolean
  readonly currentTurn: number
  readonly threads: readonly ReviewThreadView[]
  readonly draft: ReviewDraftView | null
}

export function parseReviewAddress(address: string): ReviewAddress | undefined {
  if (!address.startsWith(REVIEW_ADDRESS_PREFIX)) return undefined
  const parts = address.slice(REVIEW_ADDRESS_PREFIX.length).split('/')
  if (parts.length !== 3) return undefined
  const [encodedSessionId, seqText, turnText] = parts
  if (
    encodedSessionId === undefined ||
    seqText === undefined ||
    turnText === undefined
  )
    return undefined
  if (!/^\d+$/.test(seqText) || !/^[1-9]\d*$/.test(turnText)) return undefined
  try {
    const sessionId = decodeURIComponent(encodedSessionId)
    if (sessionId.length === 0) return undefined
    return { sessionId, seq: Number(seqText), turn: Number(turnText) }
  } catch {
    return undefined
  }
}

export function reviewAddress(coordinates: ReviewAddress): string {
  return `${REVIEW_ADDRESS_PREFIX}${encodeURIComponent(coordinates.sessionId)}/${String(coordinates.seq)}/${String(coordinates.turn)}`
}

export function summaryUrl(sessionId: string, seq: number): string {
  return `${SUMMARY_PATH}?${new URLSearchParams({ sessionId, seq: String(seq) }).toString()}`
}

export function diffUrl(sessionId: string, seq: number, index: number): string {
  return `${DIFF_PATH}?${new URLSearchParams({ sessionId, seq: String(seq), index: String(index) }).toString()}`
}

export function reviewStateUrl(
  sessionId: string,
  seq: number,
  turn: number,
): string {
  return `${REVIEW_STATE_PATH}?${new URLSearchParams({
    sessionId,
    seq: String(seq),
    turn: String(turn),
  }).toString()}`
}
