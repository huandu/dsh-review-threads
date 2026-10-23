import { describe, expect, it } from 'vitest'
import {
  diffUrl,
  parseReviewAddress,
  revisionReviewAddress,
  reviewAddress,
  SUMMARY_PATH,
  summaryUrl,
  workReviewAddress,
} from '../src/protocol.js'

describe('review protocol', () => {
  it('round trips the official review address', () => {
    const coordinates = {
      sessionId: 'session/a',
      seq: 12,
      turn: 3,
    }
    expect(parseReviewAddress(reviewAddress(coordinates))).toEqual({
      kind: 'turn',
      ...coordinates,
    })
  })

  it('rejects malformed addresses', () => {
    expect(
      parseReviewAddress('dsh-resource://changes-review/session/a/-1/1'),
    ).toBeUndefined()
    expect(
      parseReviewAddress('dsh-resource://changes-review/session/a/1/0'),
    ).toBeUndefined()
    expect(parseReviewAddress('https://example.com')).toBeUndefined()
  })

  it('round trips work and revision scope addresses', () => {
    expect(
      parseReviewAddress(workReviewAddress('work:repo/session:head')),
    ).toEqual({ kind: 'work', scopeKey: 'work:repo/session:head' })
    expect(
      parseReviewAddress(revisionReviewAddress('rev:repo:one:two:spec')),
    ).toEqual({
      kind: 'revision',
      scopeKey: 'rev:repo:one:two:spec',
    })
    expect(
      parseReviewAddress('dsh-resource://changes-review/work/not-work'),
    ).toBeUndefined()
  })

  it('builds authenticated relative routes', () => {
    expect(summaryUrl('a/b', 4)).toBe(`${SUMMARY_PATH}?sessionId=a%2Fb&seq=4`)
    expect(diffUrl('a/b', 4, 2)).toBe(
      '/api/plugins/dsh-review-threads/changes.diff?sessionId=a%2Fb&seq=4&index=2',
    )
  })
})
