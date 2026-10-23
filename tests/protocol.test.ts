import { describe, expect, it } from 'vitest'
import {
  diffUrl,
  parseReviewAddress,
  reviewAddress,
  SUMMARY_PATH,
  summaryUrl,
} from '../src/protocol.js'

describe('review protocol', () => {
  it('round trips the official review address', () => {
    const coordinates = {
      sessionId: 'session/a',
      seq: 12,
      turn: 3,
    }
    expect(parseReviewAddress(reviewAddress(coordinates))).toEqual(coordinates)
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

  it('builds authenticated relative routes', () => {
    expect(summaryUrl('a/b', 4)).toBe(`${SUMMARY_PATH}?sessionId=a%2Fb&seq=4`)
    expect(diffUrl('a/b', 4, 2)).toBe(
      '/api/plugins/dsh-review-threads/changes.diff?sessionId=a%2Fb&seq=4&index=2',
    )
  })
})
