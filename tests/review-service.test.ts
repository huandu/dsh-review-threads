import { describe, expect, it } from 'vitest'
import { createMemoryService, sessionId } from './helpers/memory-domain.js'

const anchor = {
  path: 'src/a.ts',
  side: 'new' as const,
  line: 12,
  lineText: 'const value = 1',
  beforeText: 'function main() {',
  afterText: 'return value',
  hunkHeader: '@@ -10,3 +10,4 @@',
  hunkText: ' function main() {\n+const value = 1\n return value',
  snapshotRevision: 'snap-1',
}

describe('ReviewThreadService', () => {
  it('keeps one Review per resolved turn scope', async () => {
    const { service } = createMemoryService()
    const first = await service.resolveTurn({
      sessionId: sessionId(),
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    const second = await service.resolveTurn({
      sessionId: sessionId(),
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    expect(second.reviewId).toBe(first.reviewId)
    expect(service.getReview(first.reviewId)?.activeScopeKey).toBe(
      first.scopeKey,
    )
  })

  it('hides user draft comments from AI until submission', async () => {
    const { service, followups } = createMemoryService()
    const scope = await service.resolveTurn({
      sessionId: sessionId(),
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    const added = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: sessionId(),
      turn: 2,
      anchor,
      body: 'Please explain this.',
    })
    expect(service.aiThreads(scope.reviewId)).toHaveLength(0)
    expect(added.thread.comments).toHaveLength(1)

    const submission = await service.submitDraft(added.draft.draftId)
    expect(submission.verdict).toBe('comment')
    expect(submission.state).toBe('submitted')
    expect(followups).toHaveLength(1)
    expect(service.aiThreads(scope.reviewId)[0]?.comments[0]?.body).toBe(
      'Please explain this.',
    )
  })

  it('merges AI comments into a user draft thread without exposing draft text', async () => {
    const { service } = createMemoryService()
    const scope = await service.resolveTurn({
      sessionId: sessionId(),
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: sessionId(),
      turn: 2,
      anchor,
      body: 'Hidden draft',
    })
    const thread = await service.addAgentComment({
      reviewId: scope.reviewId,
      anchor,
      body: 'Agent context',
    })
    expect(thread.comments).toHaveLength(2)
    expect(service.aiThreads(scope.reviewId)[0]?.comments).toEqual([
      expect.objectContaining({ author: 'agent', body: 'Agent context' }),
    ])
  })

  it('does not change the Review decision when a thread is resolved', async () => {
    const { service } = createMemoryService()
    const scope = await service.resolveTurn({
      sessionId: sessionId(),
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    const added = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: sessionId(),
      turn: 2,
      anchor,
      body: 'Fix this.',
    })
    await service.updateDraft(added.draft.draftId, {
      verdict: 'request_changes',
    })
    await service.submitDraft(added.draft.draftId)

    await service.setThreadStatus({
      reviewId: scope.reviewId,
      sessionId: sessionId(),
      turn: 3,
      threadId: added.thread.threadId,
      status: 'resolved',
    })
    expect(service.getReview(scope.reviewId)?.currentDecision).toBe(
      'request_changes',
    )
  })

  it('makes approval available only after blocking feedback and a later code change', async () => {
    const { service } = createMemoryService()
    const scope = await service.resolveTurn({
      sessionId: sessionId(),
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    const added = await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: sessionId(),
      turn: 2,
      anchor,
      body: 'Change this.',
    })
    await service.updateDraft(added.draft.draftId, {
      verdict: 'request_changes',
    })
    await service.submitDraft(added.draft.draftId)
    expect(service.approvalAvailable(scope.reviewId, sessionId())).toBe(false)
    await service.markCodeChanged(sessionId())
    expect(service.approvalAvailable(scope.reviewId, sessionId())).toBe(true)

    await service.setThreadStatus({
      reviewId: scope.reviewId,
      sessionId: sessionId(),
      turn: 3,
      threadId: added.thread.threadId,
      status: 'resolved',
    })
    expect(service.approvalAvailable(scope.reviewId, sessionId())).toBe(false)
    expect(service.getReview(scope.reviewId)?.currentDecision).toBe(
      'request_changes',
    )
  })

  it('keeps approval as a non-terminal decision', async () => {
    const { service } = createMemoryService()
    const scope = await service.resolveTurn({
      sessionId: sessionId(),
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    const draft = await service.ensureDraft(scope.reviewId, sessionId(), 2)
    await service.updateDraft(draft.draftId, { verdict: 'approve' })
    await service.submitDraft(draft.draftId)
    expect(service.getReview(scope.reviewId)?.currentDecision).toBe('approve')

    await service.addAgentComment({
      reviewId: scope.reviewId,
      anchor,
      body: 'A later question.',
    })
    expect(service.aiThreads(scope.reviewId)).toHaveLength(1)
  })

  it('reports body-free diagnostics and clears only session drafts', async () => {
    const { service } = createMemoryService()
    const session = sessionId()
    const scope = await service.resolveTurn({
      sessionId: session,
      eventSeq: 5,
      turn: 2,
      patchDigest: 'patch-1',
    })
    await service.addUserComment({
      reviewId: scope.reviewId,
      sessionId: session,
      turn: 2,
      anchor,
      body: 'Draft body must not appear in diagnostics.',
    })
    const diagnostics = service.diagnostics(session)
    expect(diagnostics).toMatchObject({
      scopes: 1,
      reviews: 1,
      sessionScopes: 1,
      sessionDrafts: 1,
    })
    expect(JSON.stringify(diagnostics)).not.toContain('Draft body')
    expect(await service.clearDraftsForSession(session)).toBe(1)
    expect(service.diagnostics(session).sessionDrafts).toBe(0)
  })
})
