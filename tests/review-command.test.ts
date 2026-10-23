import { describe, expect, it } from 'vitest'
import { parseReviewCommand } from '../src/review-command.js'

describe('review command', () => {
  it('opens the working tree without arguments', () => {
    expect(parseReviewCommand('')).toEqual({ kind: 'working' })
  })

  it('parses an explicit range and path filters', () => {
    expect(parseReviewCommand(' main...feature -- src/a.ts src/b.ts ')).toEqual(
      {
        kind: 'revision',
        range: 'main...feature',
        pathFilters: ['src/a.ts', 'src/b.ts'],
      },
    )
  })

  it('rejects malformed ranges and unsafe path filters', () => {
    expect(() => parseReviewCommand('main')).toThrow(/base.*head/)
    expect(() => parseReviewCommand('main..head -- /etc/passwd')).toThrow(
      /path filter/,
    )
  })
})
