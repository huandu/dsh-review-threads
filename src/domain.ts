import { domainTable, defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const timestamp = z.iso.datetime()
const id = z.string().min(1).max(256)
const body = z.string().min(1).max(20_000)

export const decisionSchema = z.enum([
  'approve',
  'comment',
  'request_changes',
  'reject',
])
export type Decision = z.infer<typeof decisionSchema>

export const threadStatusSchema = z.enum(['open', 'resolved', 'outdated'])
export type ThreadStatus = z.infer<typeof threadStatusSchema>

export const authorSchema = z.enum(['user', 'agent'])
export type AuthorKind = z.infer<typeof authorSchema>

export const diffSideSchema = z.enum(['old', 'new'])
export type DiffSide = z.infer<typeof diffSideSchema>

export const scopeRecordSchema = z
  .object({
    reviewId: id,
    scopeKey: z.string().min(1),
    kind: z.enum(['turn', 'work', 'rev']),
    repoIdentity: z.string().min(1).nullable(),
    sessionId: z.string().min(1).nullable(),
    eventSeq: z.number().int().nonnegative().nullable(),
    turn: z.number().int().positive().nullable(),
    baseOid: z.string().min(1).nullable(),
    headOid: z.string().min(1).nullable(),
    patchDigest: z.string().min(1).nullable(),
    diffSpecDigest: z.string().min(1).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()

export type ScopeRecord = z.infer<typeof scopeRecordSchema>

export const diffAnchorSchema = z
  .object({
    path: z.string().min(1).max(4096),
    side: diffSideSchema,
    line: z.number().int().positive(),
    startLine: z.number().int().positive(),
    lineHash: z.string().min(1),
    beforeHash: z.string().min(1).nullable(),
    afterHash: z.string().min(1).nullable(),
    hunkHeader: z.string().min(1),
    hunkHash: z.string().min(1),
    snapshotRevision: id,
  })
  .strict()
export type DiffAnchor = z.infer<typeof diffAnchorSchema>

export const commentRecordSchema = z
  .object({
    commentId: id,
    author: authorSchema,
    body,
    publishedBody: body.nullable(),
    publishedRevision: z.number().int().nonnegative().nullable(),
    draftId: id.nullable(),
    deletedAt: timestamp.nullable(),
    publishedDeletedAt: timestamp.nullable(),
    edited: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
export type CommentRecord = z.infer<typeof commentRecordSchema>

export const threadRecordSchema = z
  .object({
    threadId: id,
    reviewId: id,
    anchor: diffAnchorSchema,
    status: threadStatusSchema,
    publishedStatus: threadStatusSchema,
    revision: z.number().int().nonnegative(),
    publishedRevision: z.number().int().nonnegative().nullable(),
    pendingDraftIds: z.array(id),
    comments: z.array(commentRecordSchema),
    deletedAt: timestamp.nullable(),
    publishedDeletedAt: timestamp.nullable(),
    createdBy: authorSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
export type ThreadRecord = z.infer<typeof threadRecordSchema>

export const reviewRecordSchema = z
  .object({
    reviewId: id,
    activeScopeKey: z.string().min(1),
    currentDecision: decisionSchema.nullable(),
    currentDecisionAt: timestamp.nullable(),
    currentDecisionSubmissionId: id.nullable(),
    codeChangedSinceDecision: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
export type ReviewRecord = z.infer<typeof reviewRecordSchema>

export const reviewDraftSchema = z
  .object({
    draftId: id,
    reviewId: id,
    sessionId: id,
    turn: z.number().int().nonnegative(),
    verdict: decisionSchema,
    summaryText: z.string().max(20_000),
    threadIds: z.array(id),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
export type ReviewDraft = z.infer<typeof reviewDraftSchema>

export const reviewOperationSchema = z
  .object({
    kind: z.enum([
      'thread_created',
      'thread_resolved',
      'thread_reopened',
      'thread_deleted',
      'comment_added',
      'comment_edited',
      'comment_deleted',
    ]),
    threadId: id,
    commentId: id.nullable(),
    body: body.nullable(),
    anchor: diffAnchorSchema.nullable(),
    threadStatus: threadStatusSchema.nullable(),
  })
  .strict()
export type ReviewOperation = z.infer<typeof reviewOperationSchema>

export const reviewSubmissionSchema = z
  .object({
    submissionId: id,
    reviewId: id,
    sessionId: id,
    turn: z.number().int().nonnegative(),
    verdict: decisionSchema,
    summaryText: z.string().max(20_000),
    operations: z.array(reviewOperationSchema).max(2_000),
    state: z.enum(['submitting', 'submitted', 'submit_failed']),
    messageId: id.nullable(),
    createdAt: timestamp,
    submittedAt: timestamp.nullable(),
  })
  .strict()
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>

export const reviewThreadsDomain = defineDomain({
  name: 'review_threads',
  version: 1,
  layout: 'per-record',
  tables: {
    scopes: domainTable<string, ScopeRecord>(scopeRecordSchema),
    reviews: domainTable<string, ReviewRecord>(reviewRecordSchema),
    review_drafts: domainTable<string, ReviewDraft>(reviewDraftSchema),
    review_submissions: domainTable<string, ReviewSubmission>(
      reviewSubmissionSchema,
    ),
    threads: domainTable<string, ThreadRecord>(threadRecordSchema),
  },
})
