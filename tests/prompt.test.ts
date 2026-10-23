import { describe, expect, it } from 'vitest'
import { renderReviewSubmission } from '../src/prompt.js'
import type { ReviewSubmission } from '../src/domain.js'

const submission: ReviewSubmission = {
  submissionId: 'submission-1',
  reviewId: 'review-1',
  sessionId: 'session-1',
  turn: 2,
  verdict: 'request_changes',
  summaryText: 'Please simplify this.',
  operations: [
    {
      kind: 'comment_added',
      threadId: 'thread-1',
      commentId: 'comment-1',
      body: 'This branch is unreachable.',
      anchor: {
        path: 'src/a.ts',
        side: 'new',
        line: 12,
        startLine: 12,
        lineHash: 'line',
        beforeHash: null,
        afterHash: null,
        hunkHeader: '@@ -1 +1 @@',
        hunkHash: 'hunk',
        snapshotRevision: 'snap',
      },
      threadStatus: null,
    },
  ],
  state: 'submitted',
  messageId: null,
  createdAt: '2026-10-23T00:00:00.000Z',
  submittedAt: '2026-10-23T00:00:00.000Z',
}

describe('review submission prompt', () => {
  it('renders the verdict, summary, and comment context', () => {
    const text = renderReviewSubmission(submission)
    expect(text).toContain('verdict="request_changes"')
    expect(text).toContain('<summary>Please simplify this.</summary>')
    expect(text).toContain('src/a.ts:12')
    expect(text).toContain('This branch is unreachable.')
  })

  it('does not turn approval into thread resolution', () => {
    const text = renderReviewSubmission({
      ...submission,
      verdict: 'approve',
      summaryText: '',
      operations: [],
    })
    expect(text).toContain('Approval does not close the review')
    expect(text).toContain('Never infer a thread is resolved')
  })
})
