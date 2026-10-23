import { describe, expect, it } from 'vitest'
import { createAnchor, reanchor, type AnchorCandidate } from '../src/anchor.js'

const base: AnchorCandidate = {
  path: 'src/a.ts',
  side: 'new',
  line: 12,
  lineText: 'const value = 1',
  beforeText: 'function main() {',
  afterText: '  return value',
  hunkHeader: '@@ -10,3 +10,4 @@',
  hunkText: ' function main() {\n+const value = 1\n   return value',
}

describe('diff anchors', () => {
  it('keeps an exact line anchor', () => {
    const anchor = createAnchor({ ...base, snapshotRevision: 'snap-1' })
    expect(reanchor(anchor, [base])).toMatchObject({
      path: 'src/a.ts',
      line: 12,
      snapshotRevision: 'snap-1',
    })
  })

  it('moves a unique contextual match', () => {
    const anchor = createAnchor({ ...base, snapshotRevision: 'snap-1' })
    expect(
      reanchor(anchor, [
        { ...base, line: 99, lineText: 'something else' },
        { ...base, line: 20 },
      ]),
    ).toMatchObject({ line: 20 })
  })

  it('does not move through an ambiguous context match', () => {
    const anchor = createAnchor({ ...base, snapshotRevision: 'snap-1' })
    expect(
      reanchor(anchor, [
        { ...base, line: 20 },
        { ...base, line: 30 },
      ]),
    ).toBeUndefined()
  })
})
