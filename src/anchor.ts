import type { DiffAnchor, DiffSide } from './domain.js'
import { sha256 } from './scope.js'

export interface AnchorInput {
  readonly path: string
  readonly side: DiffSide
  readonly line: number
  readonly startLine?: number
  readonly lineText: string
  readonly beforeText?: string | null
  readonly afterText?: string | null
  readonly hunkHeader: string
  readonly hunkText: string
  readonly snapshotRevision: string
}

export interface AnchorCandidate {
  readonly path: string
  readonly side: DiffSide
  readonly line: number
  readonly lineText: string
  readonly beforeText: string | null
  readonly afterText: string | null
  readonly hunkHeader: string
  readonly hunkText: string
}

function optionalHash(value: string | null | undefined): string | null {
  return value === undefined || value === null ? null : sha256(value)
}

export function createAnchor(input: AnchorInput): DiffAnchor {
  return {
    path: input.path,
    side: input.side,
    line: input.line,
    startLine: input.startLine ?? input.line,
    lineHash: sha256(input.lineText),
    beforeHash: optionalHash(input.beforeText),
    afterHash: optionalHash(input.afterText),
    hunkHeader: input.hunkHeader,
    hunkHash: sha256(input.hunkText),
    snapshotRevision: input.snapshotRevision,
  }
}

export function reanchor(
  anchor: DiffAnchor,
  candidates: readonly AnchorCandidate[],
): DiffAnchor | undefined {
  const sameFile = candidates.filter(
    (candidate) =>
      candidate.path === anchor.path && candidate.side === anchor.side,
  )
  const exactHash = sameFile.filter(
    (candidate) => sha256(candidate.lineText) === anchor.lineHash,
  )
  const exact = exactHash.find((candidate) => candidate.line === anchor.line)
  if (exact !== undefined)
    return createAnchor({ ...exact, snapshotRevision: anchor.snapshotRevision })

  const contextual = exactHash.filter(
    (candidate) =>
      optionalHash(candidate.beforeText) === anchor.beforeHash &&
      optionalHash(candidate.afterText) === anchor.afterHash,
  )
  if (contextual.length === 1) {
    const match = contextual[0]
    if (match === undefined) return undefined
    return createAnchor({
      ...match,
      snapshotRevision: anchor.snapshotRevision,
    })
  }

  const hunkMatches = sameFile.filter(
    (candidate) =>
      candidate.hunkHeader === anchor.hunkHeader &&
      sha256(candidate.hunkText) === anchor.hunkHash &&
      sha256(candidate.lineText) === anchor.lineHash,
  )
  if (hunkMatches.length === 1) {
    const match = hunkMatches[0]
    if (match === undefined) return undefined
    return createAnchor({
      ...match,
      snapshotRevision: anchor.snapshotRevision,
    })
  }
  return undefined
}
