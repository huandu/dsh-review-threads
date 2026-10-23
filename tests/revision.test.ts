import { describe, expect, it } from 'vitest'
import { parseNumstat, parseUnifiedHunks } from '../src/revision.js'

describe('revision diff parsing', () => {
  it('parses ordinary, binary, and rename numstat records', () => {
    expect(
      parseNumstat(
        '3\t2\tsrc/a.ts\0-\t-\tasset.bin\0' + '3\t1\t\0old.ts\0new.ts\0',
      ),
    ).toEqual([
      { path: 'src/a.ts', added: 3, deleted: 2, binary: false },
      { path: 'asset.bin', added: 0, deleted: 0, binary: true },
      {
        oldPath: 'old.ts',
        path: 'new.ts',
        added: 3,
        deleted: 1,
        binary: false,
      },
    ])
  })

  it('accepts hunk headers with omitted counts', () => {
    expect(
      parseUnifiedHunks(
        '--- a/a.ts\n+++ b/a.ts\n@@ -7 +7 @@\n-old\n+new',
        'a.ts',
      ),
    ).toEqual([
      {
        oldStart: 7,
        oldLines: 1,
        newStart: 7,
        newLines: 1,
        lines: ['-old', '+new'],
      },
    ])
  })
})
