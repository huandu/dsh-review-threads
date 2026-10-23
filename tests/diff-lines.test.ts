import { describe, expect, it } from 'vitest'
import { flattenDiffLines } from '../src/diff-lines.js'

describe('diff lines', () => {
  it('tracks old and new line numbers and sides', () => {
    const lines = flattenDiffLines([
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 20,
        newLines: 4,
        lines: [' context', '-old', '+new', ' context 2'],
      },
    ])
    expect(lines.map((line) => [line.kind, line.side, line.line])).toEqual([
      ['context', 'new', 20],
      ['del', 'old', 11],
      ['add', 'new', 21],
      ['context', 'new', 22],
    ])
  })
})
