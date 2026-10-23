import type { ReviewDiffHunk } from './protocol.js'

export interface DiffLine {
  readonly hunkIndex: number
  readonly rowIndex: number
  readonly kind: 'add' | 'del' | 'context'
  readonly side: 'old' | 'new'
  readonly line: number
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
  readonly beforeText: string | null
  readonly afterText: string | null
  readonly hunkHeader: string
  readonly hunkText: string
}

function header(hunk: ReviewDiffHunk): string {
  return `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`
}

export function flattenDiffLines(
  hunks: readonly ReviewDiffHunk[],
): readonly DiffLine[] {
  const output: DiffLine[] = []
  hunks.forEach((hunk, hunkIndex) => {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    const hunkText = hunk.lines.join('\n')
    hunk.lines.forEach((line, rowIndex) => {
      const marker = line[0]
      const kind = marker === '+' ? 'add' : marker === '-' ? 'del' : 'context'
      const side = kind === 'del' ? 'old' : 'new'
      const lineNumber = kind === 'del' ? oldLine : newLine
      output.push({
        hunkIndex,
        rowIndex,
        kind,
        side,
        line: lineNumber,
        oldLine: kind === 'add' ? null : oldLine,
        newLine: kind === 'del' ? null : newLine,
        text: line.slice(1),
        beforeText: hunk.lines[rowIndex - 1]?.slice(1) ?? null,
        afterText: hunk.lines[rowIndex + 1]?.slice(1) ?? null,
        hunkHeader: header(hunk),
        hunkText,
      })
      if (kind !== 'add') oldLine += 1
      if (kind !== 'del') newLine += 1
    })
  })
  return output
}
