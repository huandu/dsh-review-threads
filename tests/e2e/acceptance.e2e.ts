import { describe, expect, it } from 'vitest'
import { createMemoryService, sessionId } from '../helpers/memory-domain.js'

const anchor = {
  path: 'src/a.ts',
  side: 'new' as const,
  line: 42,
  lineText: 'const changed = true',
  beforeText: 'function run() {',
  afterText: 'return changed',
  hunkHeader: '@@ -40,3 +40,4 @@',
  hunkText: ' function run() {\n+const changed = true\n return changed',
  snapshotRevision: 'snapshot-1',
}

async function turnReview() {
  const memory = createMemoryService()
  const session = sessionId()
  const scope = await memory.service.resolveTurn({
    sessionId: session,
    eventSeq: 5,
    turn: 2,
    patchDigest: 'acceptance-patch',
  })
  return { ...memory, session, scope }
}

describe('review acceptance scenarios', () => {
  it('AC-01..03 batches comments and wakes exactly once on submission', async () => {
    const { service, followups, session, scope } = await turnReview()
    const first = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      anchor,
      body: 'First line comment.',
    })
    const second = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      anchor: { ...anchor, lineText: 'same thread despite anchor text' },
      body: 'Second comment.',
    })
    expect(second.thread.threadId).toBe(first.thread.threadId)
    await service.deleteUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      threadId: second.thread.threadId,
      commentId: second.thread.comments[1]?.commentId ?? '',
    })
    await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      anchor,
      body: 'Replacement reply.',
    })
    expect(followups).toHaveLength(0)
    expect(service.aiThreads(scope.reviewId)).toHaveLength(0)

    await service.updateDraft(first.draft.draftId, {
      verdict: 'request_changes',
      summaryText: 'Apply the batch.',
    })
    const submission = await service.submitDraft(first.draft.draftId)
    expect(submission.operations.map((operation) => operation.kind)).toEqual([
      'thread_created',
      'comment_added',
      'comment_added',
    ])
    expect(followups).toHaveLength(1)
  })

  it('AC-04 and AC-05 expose AI comments immediately and resolved status after sync', async () => {
    const { service, followups, session, scope } = await turnReview()
    const agentThread = await service.addAgentComment({
      reviewId: scope.reviewId,
      anchor,
      body: 'Should this value remain configurable?',
    })
    expect(service.userThreads(scope.reviewId)[0]?.threadId).toBe(
      agentThread.threadId,
    )
    expect(followups).toHaveLength(0)

    const user = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      anchor,
      body: 'Yes, keep it configurable.',
    })
    await service.updateDraft(user.draft.draftId, { verdict: 'comment' })
    await service.submitDraft(user.draft.draftId)
    await service.setThreadStatus({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 3,
      threadId: user.thread.threadId,
      status: 'resolved',
    })
    expect(service.aiThreads(scope.reviewId)[0]?.status).toBe('open')
    const pending = service.draftFor(scope.reviewId, session)
    if (pending === undefined) throw new Error('Expected a pending resolve')
    await service.submitDraft(pending.draftId)
    expect(service.aiThreads(scope.reviewId)[0]).toMatchObject({
      threadId: user.thread.threadId,
      status: 'resolved',
      comments: [
        expect.objectContaining({ author: 'agent' }),
        expect.objectContaining({ body: 'Yes, keep it configurable.' }),
      ],
    })
  })

  it('AC-06 shares one revision Review across sessions', async () => {
    const { service, session } = await turnReview()
    const revision = await service.resolveRevision({
      repoIdentity: 'remote:https://example.com/acme/repo',
      repoRoot: '/repo',
      baseOid: 'a'.repeat(40),
      headOid: 'b'.repeat(40),
    })
    const same = await service.resolveRevision({
      repoIdentity: 'remote:https://example.com/acme/repo',
      repoRoot: '/repo',
      baseOid: 'a'.repeat(40),
      headOid: 'b'.repeat(40),
    })
    expect(same).toEqual(revision)
    const otherSession = sessionId('session-2')
    await service.addUserComment({
      reviewId: revision.reviewId,
      sessionId: session,
      turn: 0,
      anchor: { ...anchor, snapshotRevision: revision.scopeKey },
      body: 'Session A',
    })
    await service.addUserComment({
      reviewId: revision.reviewId,
      sessionId: otherSession,
      turn: 0,
      anchor: { ...anchor, snapshotRevision: revision.scopeKey },
      body: 'Session B',
    })
    expect(service.userThreads(revision.reviewId)[0]?.comments).toHaveLength(2)
  })

  it('AC-08 sends a body-free thread tombstone at the next submission', async () => {
    const { service, session, scope } = await turnReview()
    const added = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      anchor,
      body: 'Public comment.',
    })
    await service.updateDraft(added.draft.draftId, { verdict: 'comment' })
    await service.submitDraft(added.draft.draftId)
    await service.addAgentComment({
      reviewId: scope.reviewId,
      anchor,
      body: 'AI follow-up.',
    })
    await service.deleteThread({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 3,
      threadId: added.thread.threadId,
    })
    const pending = service.draftFor(scope.reviewId, session)
    if (pending === undefined) throw new Error('Expected a deletion draft')
    const submission = await service.submitDraft(pending.draftId)
    expect(service.aiThreads(scope.reviewId)).toHaveLength(0)
    expect(submission.operations).toContainEqual({
      kind: 'thread_deleted',
      threadId: added.thread.threadId,
      commentId: null,
      body: null,
      anchor: null,
      threadStatus: null,
    })
  })

  it('AC-09..13 preserves blocking, approval, draft, and non-terminal semantics', async () => {
    const { service, session, scope } = await turnReview()
    const added = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      anchor,
      body: 'Blocking issue.',
    })
    await service.updateDraft(added.draft.draftId, {
      verdict: 'request_changes',
    })
    await service.submitDraft(added.draft.draftId)
    await service.markCodeChanged(session)
    expect(service.approvalAvailable(scope.reviewId, session)).toBe(true)

    await service.setThreadStatus({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 3,
      threadId: added.thread.threadId,
      status: 'resolved',
    })
    expect(service.approvalAvailable(scope.reviewId, session)).toBe(false)
    const resolveDraft = service.draftFor(scope.reviewId, session)
    if (resolveDraft === undefined) throw new Error('Expected a resolve draft')
    expect(resolveDraft.verdict).toBe('comment')
    await service.updateDraft(resolveDraft.draftId, { verdict: 'approve' })
    await service.submitDraft(resolveDraft.draftId)
    expect(service.getReview(scope.reviewId)?.currentDecision).toBe('approve')

    await service.addAgentComment({
      reviewId: scope.reviewId,
      anchor: {
        ...anchor,
        line: 43,
        lineText: 'return changed',
      },
      body: 'Post-approval note.',
    })
    const later = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 4,
      anchor: { ...anchor, line: 44 },
      body: 'Post-approval discussion.',
    })
    expect(service.getReview(scope.reviewId)?.currentDecision).toBe('approve')
    await service.updateDraft(later.draft.draftId, { verdict: 'reject' })
    await service.submitDraft(later.draft.draftId)
    expect(service.getReview(scope.reviewId)?.currentDecision).toBe('reject')
  })
})
